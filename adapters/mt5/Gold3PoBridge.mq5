#property strict
#property version "2.10"
#property description "GOLD-3Po RoboForex MT5 bridge: tick history, live quotes and live liquidity-zone drawing on the chart."

input string HistoryUrl = "http://127.0.0.1:8787/v1/ingest/mt5/history";
input string LiveBatchUrl = "http://127.0.0.1:8787/v1/ingest/mt5/live-batch";
input string IngestToken = "";
input int MinIntervalMs = 100;
input int RequestTimeoutMs = 5000;
input int HistoryDays = 30;
input int HistoryBatchSize = 1000;
input int HistoryRetryMinutes = 15;
input bool DrawZones = true;
input string ZonesUrl = "http://127.0.0.1:8787/v1/chart/zones";
input int ZonesRefreshSeconds = 5;
input int ZoneLookbackBars = 200;
input color BuyZoneColor = clrTeal;
input color SellZoneColor = clrIndianRed;

ulong sequenceNumber = 0;
string sequenceKey = "";
MqlTick pendingTicks[];
ulong pendingSequences[];
bool queueLimitLogged = false;
bool historySynchronized = false;
ulong nextHistoryRetryAt = 0;
MqlTick historyTicks[];
int historyOffset = 0;
ulong historySequence = 0;
ulong historyTotalTicks = 0;
datetime historyCursor = 0;
datetime historyEnd = 0;
datetime historyChunkEnd = 0;
bool historyChunkLoaded = false;
int historyFailures = 0;
ulong nextZonesRefreshAt = 0;
string zonesStatusText = "";
int zonesDrawnCount = 0;

string TickStamp(const long timeMsc)
{
   datetime seconds = (datetime)(timeMsc / 1000);
   string stamp = TimeToString(seconds, TIME_DATE | TIME_SECONDS);
   StringReplace(stamp, ".", "-");
   StringReplace(stamp, " ", "T");
   return stamp + StringFormat(".%03dZ", (int)(timeMsc % 1000));
}

bool PostJson(const string url, const string body)
{
   char data[];
   int copied = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(copied > 0) ArrayResize(data, copied - 1);
   char result[];
   string responseHeaders;
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + IngestToken + "\r\n";
   int status = WebRequest("POST", url, headers, RequestTimeoutMs, data, result, responseHeaders);
   if(status < 200 || status >= 300)
   {
      Print("GOLD-3Po bridge: POST failed status=", status, " error=", GetLastError(), " url=", url);
      return false;
   }
   return true;
}

bool SendHistoryBatch(MqlTick &ticks[], const int first, const int count, ulong &historySequence)
{
   string body = "{\"source\":\"mt5\",\"symbol\":\"" + _Symbol + "\",\"ticks\":[";
   for(int i=0; i<count; i++)
   {
      MqlTick tick = ticks[first+i];
      historySequence++;
      double lastPrice = tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2.0;
      string eventId = StringFormat("%s-%I64d-%.10f-%.10f-%.10f-%I64u-%.4f-%u", _Symbol, tick.time_msc, tick.bid, tick.ask, lastPrice, tick.volume, tick.volume_real, tick.flags);
      if(i > 0) body += ",";
      body += StringFormat(
         "{\"timestamp\":\"%s\",\"sequence\":%I64u,\"eventId\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"tickVolume\":%I64u,\"realVolume\":%.4f,\"flags\":%u}",
         TickStamp(tick.time_msc), historySequence, eventId, tick.bid, tick.ask, lastPrice, tick.volume, tick.volume_real, tick.flags
      );
   }
   body += "]}";
   return PostJson(HistoryUrl, body);
}

void StartHistorySync()
{
   int days = MathMax(1, MathMin(HistoryDays, 90));
   historyEnd = TimeGMT();
   historyCursor = historyEnd - days * 86400;
   historySequence = 0;
   historyTotalTicks = 0;
   historyOffset = 0;
   historyChunkLoaded = false;
   ArrayFree(historyTicks);
   historySynchronized = false;
   Print("GOLD-3Po: scheduled up to ", days, " days of broker history. Live collection starts immediately.");
}

void ScheduleHistoryRetry()
{
   historyFailures++;
   ulong delayMs = 1000;
   int exponent = MathMin(historyFailures - 1, 7);
   for(int i=0; i<exponent; i++) delayMs *= 2;
   if(historyFailures >= 8) delayMs = (ulong)MathMax(1, HistoryRetryMinutes) * 60000;
   nextHistoryRetryAt = GetTickCount64() + delayMs;
}

void ProcessHistorySync()
{
   if(historySynchronized) return;
   int batchSize = MathMax(10, MathMin(HistoryBatchSize, 1000));

   if(!historyChunkLoaded)
   {
      if(historyCursor >= historyEnd)
      {
         historySynchronized = true;
         Print("GOLD-3Po: history sync completed. Ticks uploaded: ", historyTotalTicks, ". Repeated ticks are de-duplicated by the API.");
         return;
      }

      historyChunkEnd = (datetime)MathMin((long)historyEnd, (long)(historyCursor + 3600));
      MqlTick copiedTicks[];
      ulong fromMsc = (ulong)historyCursor * 1000;
      ulong toMsc = (ulong)historyChunkEnd * 1000 - 1;
      ResetLastError();
      int copied = CopyTicksRange(_Symbol, copiedTicks, COPY_TICKS_ALL, fromMsc, toMsc);
      if(copied < 0)
      {
         Print("GOLD-3Po: history chunk unavailable at ", TimeToString(historyCursor), " error=", GetLastError(), ". Retry scheduled.");
         ScheduleHistoryRetry();
         return;
      }

      ArrayFree(historyTicks);
      if(copied > 0)
      {
         ArrayResize(historyTicks, copied);
         ArrayCopy(historyTicks, copiedTicks, 0, 0, copied);
      }
      historyOffset = 0;
      historyChunkLoaded = true;
   }

   int total = ArraySize(historyTicks);
   if(historyOffset < total)
   {
      int count = MathMin(batchSize, total - historyOffset);
      if(!SendHistoryBatch(historyTicks, historyOffset, count, historySequence))
      {
         Print("GOLD-3Po: history upload failed; the same batch will be retried idempotently.");
         ScheduleHistoryRetry();
         return;
      }
      historyOffset += count;
      historyTotalTicks += (ulong)count;
      historyFailures = 0;
   }

   if(historyOffset >= total)
   {
      ArrayFree(historyTicks);
      historyOffset = 0;
      historyChunkLoaded = false;
      historyCursor = historyChunkEnd;
   }
   nextHistoryRetryAt = GetTickCount64();
}

bool FlushLiveBatch()
{
   int available = ArraySize(pendingTicks);
   if(available <= 0) return true;
   int count = MathMin(1000, available);
   string body = "{\"source\":\"mt5\",\"symbol\":\"" + _Symbol + "\",\"ticks\":[";
   for(int i=0; i<count; i++)
   {
      MqlTick tick = pendingTicks[i];
      double lastPrice = tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2.0;
      string eventId = StringFormat("LIVE-%I64u", pendingSequences[i]);
      if(i > 0) body += ",";
      body += StringFormat(
         "{\"timestamp\":\"%s\",\"sequence\":%I64u,\"eventId\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"tickVolume\":%I64u,\"realVolume\":%.4f,\"flags\":%u}",
         TickStamp(tick.time_msc), pendingSequences[i], eventId, tick.bid, tick.ask, lastPrice, tick.volume, tick.volume_real, tick.flags
      );
   }
   body += "]}";
   if(!PostJson(LiveBatchUrl, body)) return false;
   for(int i=count; i<available; i++)
   {
      pendingTicks[i-count] = pendingTicks[i];
      pendingSequences[i-count] = pendingSequences[i];
   }
   ArrayResize(pendingTicks, available-count);
   ArrayResize(pendingSequences, available-count);
   return true;
}

ulong NextSequence()
{
   for(int attempt=0; attempt<32; attempt++)
   {
      double current = GlobalVariableGet(sequenceKey);
      double candidate = MathMax(current, (double)sequenceNumber) + 1.0;
      if(candidate >= 9007199254740991.0) return 0;
      if(GlobalVariableSetOnCondition(sequenceKey, candidate, current))
      {
         sequenceNumber = (ulong)candidate;
         return sequenceNumber;
      }
   }
   Print("GOLD-3Po: could not reserve a unique live sequence number.");
   return 0;
}

//--- Liquidity-zone drawing -------------------------------------------------

bool GetJson(const string url, string &response)
{
   char data[];
   ArrayResize(data, 0);
   char result[];
   string responseHeaders;
   string headers = "Authorization: Bearer " + IngestToken + "\r\n";
   ResetLastError();
   int status = WebRequest("GET", url, headers, RequestTimeoutMs, data, result, responseHeaders);
   if(status == 200)
   {
      response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      return true;
   }
   if(status == 402)
   {
      response = "license_required";
      return false;
   }
   Print("GOLD-3Po zones: GET failed status=", status, " error=", GetLastError());
   response = "";
   return false;
}

string JsonStringField(const string obj, const string key)
{
   string pattern = "\"" + key + "\":\"";
   int start = StringFind(obj, pattern);
   if(start < 0) return "";
   start += StringLen(pattern);
   int end = StringFind(obj, "\"", start);
   if(end < 0) return "";
   return StringSubstr(obj, start, end - start);
}

double JsonNumberField(const string obj, const string key)
{
   string pattern = "\"" + key + "\":";
   int start = StringFind(obj, pattern);
   if(start < 0) return EMPTY_VALUE;
   start += StringLen(pattern);
   int end = start;
   int len = StringLen(obj);
   while(end < len)
   {
      ushort ch = StringGetCharacter(obj, end);
      if((ch >= '0' && ch <= '9') || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E') end++;
      else break;
   }
   if(end == start) return EMPTY_VALUE;
   return StringToDouble(StringSubstr(obj, start, end - start));
}

void DeleteZoneObjects()
{
   ObjectsDeleteAll(0, "G3P_");
}

void SetZonesStatus(const string text)
{
   zonesStatusText = text;
   string name = "G3P_STATUS";
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, 20);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrSilver);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 8);
   ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   ObjectSetString(0, name, OBJPROP_TEXT, text);
}

void RefreshZones()
{
   string response;
   string url = ZonesUrl + "?symbol=" + _Symbol + "&source=mt5";
   if(!GetJson(url, response))
   {
      DeleteZoneObjects();
      zonesDrawnCount = 0;
      if(response == "license_required") SetZonesStatus("GOLD-3Po: licence required — activate in the app to see zones");
      else SetZonesStatus("GOLD-3Po zones: API unreachable");
      ChartRedraw(0);
      return;
   }
   int zonesStart = StringFind(response, "\"zones\":[");
   if(zonesStart < 0)
   {
      DeleteZoneObjects();
      zonesDrawnCount = 0;
      SetZonesStatus("GOLD-3Po zones: no zone data yet");
      ChartRedraw(0);
      return;
   }
   zonesStart += StringLen("\"zones\":[");
   int zonesEnd = StringFind(response, "]", zonesStart);
   if(zonesEnd < 0) return;
   string zonesJson = StringSubstr(response, zonesStart, zonesEnd - zonesStart);

   DeleteZoneObjects();
   zonesDrawnCount = 0;
   int buyCount = 0, sellCount = 0;
   int availableBars = Bars(_Symbol, _Period);
   int lookback = (int)MathMin(ZoneLookbackBars, MathMax(10, availableBars - 1));
   datetime timeLeft = iTime(_Symbol, _Period, lookback);
   datetime timeRight = TimeCurrent() + PeriodSeconds() * 20;
   if(timeLeft <= 0) timeLeft = TimeCurrent() - PeriodSeconds() * lookback;

   int cursor = 0;
   while(true)
   {
      int objStart = StringFind(zonesJson, "{", cursor);
      if(objStart < 0) break;
      int objEnd = StringFind(zonesJson, "}", objStart);
      if(objEnd < 0) break;
      string obj = StringSubstr(zonesJson, objStart, objEnd - objStart + 1);
      cursor = objEnd + 1;

      string id = JsonStringField(obj, "id");
      string side = JsonStringField(obj, "side");
      double low = JsonNumberField(obj, "low");
      double high = JsonNumberField(obj, "high");
      double strength = JsonNumberField(obj, "strength");
      string distance = JsonStringField(obj, "distance");
      string state = JsonStringField(obj, "state");
      if(id == "" || low == EMPTY_VALUE || high == EMPTY_VALUE || high <= low) continue;

      color zoneColor = (side == "buy") ? BuyZoneColor : SellZoneColor;
      string rectName = "G3P_ZONE_" + id;
      if(ObjectCreate(0, rectName, OBJ_RECTANGLE, 0, timeLeft, low, timeRight, high))
      {
         ObjectSetInteger(0, rectName, OBJPROP_COLOR, zoneColor);
         ObjectSetInteger(0, rectName, OBJPROP_STYLE, STYLE_SOLID);
         ObjectSetInteger(0, rectName, OBJPROP_WIDTH, 1);
         ObjectSetInteger(0, rectName, OBJPROP_FILL, false);
         ObjectSetInteger(0, rectName, OBJPROP_BACK, true);
         ObjectSetInteger(0, rectName, OBJPROP_SELECTABLE, false);
         ObjectSetString(0, rectName, OBJPROP_TOOLTIP, "GOLD-3Po " + side + "-side liquidity · strength " + DoubleToString(strength, 2) + " · " + state);
      }
      string labelName = "G3P_LBL_" + id;
      double midPrice = (low + high) / 2.0;
      if(ObjectCreate(0, labelName, OBJ_TEXT, 0, timeRight, midPrice))
      {
         ObjectSetString(0, labelName, OBJPROP_TEXT, " " + side + " LQ " + DoubleToString(strength, 2) + " " + distance);
         ObjectSetInteger(0, labelName, OBJPROP_COLOR, zoneColor);
         ObjectSetInteger(0, labelName, OBJPROP_FONTSIZE, 8);
         ObjectSetString(0, labelName, OBJPROP_FONT, "Consolas");
         ObjectSetInteger(0, labelName, OBJPROP_ANCHOR, ANCHOR_LEFT);
         ObjectSetInteger(0, labelName, OBJPROP_SELECTABLE, false);
      }
      zonesDrawnCount++;
      if(side == "buy") buyCount++; else sellCount++;
   }
   SetZonesStatus(StringFormat("GOLD-3Po zones: %d (%d buy / %d sell) · %s", zonesDrawnCount, buyCount, sellCount, TimeToString(TimeCurrent(), TIME_SECONDS)));
   ChartRedraw(0);
}

void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.bid <= 0 || tick.ask < tick.bid) return;
   int queued = ArraySize(pendingTicks);
   if(queued >= 20000)
   {
      if(!queueLimitLogged)
      {
         Print("GOLD-3Po: live buffer is full; incoming ticks are being skipped until delivery recovers.");
         queueLimitLogged = true;
      }
      return;
   }
   ulong nextSequence = NextSequence();
   if(nextSequence == 0) return;
   if(ArrayResize(pendingTicks, queued+1) != queued+1) return;
   if(ArrayResize(pendingSequences, queued+1) != queued+1)
   {
      ArrayResize(pendingTicks, queued);
      return;
   }
   pendingTicks[queued] = tick;
   pendingSequences[queued] = nextSequence;
   if(queued == 0) queueLimitLogged = false;
}

int OnInit()
{
   sequenceKey = "G3P_SEQ_" + _Symbol;
   ulong epochSeed = (ulong)TimeGMT() * 1000;
   if(!GlobalVariableCheck(sequenceKey)) GlobalVariableSet(sequenceKey, (double)epochSeed);
   double storedSequence = GlobalVariableGet(sequenceKey);
   if(storedSequence < (double)epochSeed)
   {
      GlobalVariableSetOnCondition(sequenceKey, (double)epochSeed, storedSequence);
      storedSequence = GlobalVariableGet(sequenceKey);
   }
   sequenceNumber = (ulong)storedSequence;
   if(StringLen(IngestToken) < 24)
   {
      Print("GOLD-3Po: set an ingest token of at least 24 characters.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!SymbolSelect(_Symbol, true)) return INIT_FAILED;
   StartHistorySync();
   nextHistoryRetryAt = GetTickCount64();
   nextZonesRefreshAt = GetTickCount64() + 2000;
   EventSetMillisecondTimer(MathMax(100, MinIntervalMs));
   Print("GOLD-3Po bridge ready for ", _Symbol, ". Live quotes, asynchronous history sync and zone drawing enabled.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   DeleteZoneObjects();
   ChartRedraw(0);
}

void OnTimer()
{
   ulong nowMs = GetTickCount64();
   if(ArraySize(pendingTicks) > 0)
   {
      if(!FlushLiveBatch())
      {
         Print("GOLD-3Po: pending live tick batch retained for retry. Check API/WebRequest connectivity.");
         return;
      }
   }
   if(!historySynchronized && nowMs >= nextHistoryRetryAt)
      ProcessHistorySync();
   if(DrawZones && nowMs >= nextZonesRefreshAt)
   {
      RefreshZones();
      nextZonesRefreshAt = nowMs + (ulong)MathMax(1, ZonesRefreshSeconds) * 1000;
   }
}
