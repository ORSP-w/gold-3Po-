#property strict
#property version "2.00"
#property description "GOLD-3Po RoboForex MT5 bridge: 30-day available tick history plus live broker quotes."

input string HistoryUrl = "http://127.0.0.1:8787/v1/ingest/mt5/history";
input string LiveBatchUrl = "http://127.0.0.1:8787/v1/ingest/mt5/live-batch";
input string IngestToken = "";
input int MinIntervalMs = 100;
input int RequestTimeoutMs = 5000;
input int HistoryDays = 30;
input int HistoryBatchSize = 1000;
input int HistoryRetryMinutes = 15;

ulong sequenceNumber = 0;
string sequenceKey = "";
MqlTick pendingTicks[];
ulong pendingSequences[];
bool queueLimitLogged = false;
bool historySynchronized = false;
ulong nextHistoryRetryAt = 0;

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

bool SyncHistory()
{
   int days = MathMax(1, MathMin(HistoryDays, 90));
   int batchSize = MathMax(10, MathMin(HistoryBatchSize, 1000));
   bool complete = true;
   ulong totalTicks = 0;
   ulong historySequence = 0;
   datetime endTime = TimeGMT();
   datetime startTime = endTime - days * 86400;
   Print("GOLD-3Po: requesting up to ", days, " days of broker ticks for ", _Symbol);
   for(datetime cursor=startTime; cursor<endTime; cursor+=3600)
   {
      datetime stop = (datetime)MathMin((long)endTime, (long)(cursor+3600));
      MqlTick ticks[];
      ulong fromMsc = (ulong)cursor * 1000;
      ulong toMsc = (ulong)stop * 1000 - 1;
      ResetLastError();
      int copied = CopyTicksRange(_Symbol, ticks, COPY_TICKS_ALL, fromMsc, toMsc);
      if(copied < 0)
      {
         Print("GOLD-3Po: history chunk unavailable at ", TimeToString(cursor), " error=", GetLastError());
         complete = false;
         continue;
      }
      for(int offset=0; offset<copied; offset+=batchSize)
      {
         int count = MathMin(batchSize, copied-offset);
         if(!SendHistoryBatch(ticks, offset, count, historySequence))
         {
            Print("GOLD-3Po: history upload interrupted; live feed will continue and history sync will retry.");
            complete = false;
            break;
         }
         totalTicks += (ulong)count;
      }
   }
   if(complete) Print("GOLD-3Po: history sync completed. Ticks uploaded: ", totalTicks, ". Repeated ticks are de-duplicated by the API.");
   else Print("GOLD-3Po: history sync incomplete. Will retry after ", HistoryRetryMinutes, " minutes.");
   return complete;
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
   historySynchronized = SyncHistory();
   nextHistoryRetryAt = GetTickCount64() + (ulong)MathMax(1, HistoryRetryMinutes) * 60000;
   EventSetMillisecondTimer(MathMax(100, MinIntervalMs));
   Print("GOLD-3Po bridge ready for ", _Symbol, ". Live quotes enabled.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
{
   ulong nowMs = GetTickCount64();
   if(!historySynchronized && nowMs >= nextHistoryRetryAt)
   {
      historySynchronized = SyncHistory();
      nextHistoryRetryAt = nowMs + (ulong)MathMax(1, HistoryRetryMinutes) * 60000;
   }
   if(ArraySize(pendingTicks) > 0 && !FlushLiveBatch())
      Print("GOLD-3Po: pending live tick batch retained for retry. Check API/WebRequest connectivity.");
}
