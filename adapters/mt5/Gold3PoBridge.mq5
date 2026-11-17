#property strict
#property version "2.00"
#property description "GOLD-3Po RoboForex MT5 bridge: 30-day available tick history plus live broker quotes."

input string IngestUrl = "http://127.0.0.1:8787/v1/ingest/mt5/tick";
input string HistoryUrl = "http://127.0.0.1:8787/v1/ingest/mt5/history";
input string IngestToken = "";
input int MinIntervalMs = 100;
input int RequestTimeoutMs = 5000;
input int HistoryDays = 30;
input int HistoryBatchSize = 100;

ulong sequenceNumber = 0;
ulong lastSentAt = 0;
string sequenceKey = "";
int lastHttpStatus = 0;

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
      if(i > 0) body += ",";
      body += StringFormat(
         "{\"timestamp\":\"%s\",\"sequence\":%I64u,\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"tickVolume\":%I64u,\"realVolume\":%.4f,\"flags\":%u}",
         TickStamp(tick.time_msc), historySequence, tick.bid, tick.ask, lastPrice, tick.volume, tick.volume_real, tick.flags
      );
   }
   body += "]}";
   return PostJson(HistoryUrl, body);
}

void SyncHistory()
{
   int days = MathMax(1, MathMin(HistoryDays, 90));
   int batchSize = MathMax(10, MathMin(HistoryBatchSize, 250));
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
         continue;
      }
      for(int offset=0; offset<copied; offset+=batchSize)
      {
         int count = MathMin(batchSize, copied-offset);
         if(!SendHistoryBatch(ticks, offset, count, historySequence))
         {
            Print("GOLD-3Po: history upload interrupted; reconnect and restart EA to retry.");
            return;
         }
      }
   }
   Print("GOLD-3Po: history sync finished; accepted sequence range 1..", historySequence);
}

int OnInit()
{
   sequenceKey = "G3P_SEQ_" + _Symbol;
   ulong epochSeed = (ulong)TimeGMT() * 1000;
   if(GlobalVariableCheck(sequenceKey)) sequenceNumber = (ulong)MathMax((double)epochSeed, GlobalVariableGet(sequenceKey));
   else sequenceNumber = epochSeed;
   if(StringLen(IngestToken) < 24)
   {
      Print("GOLD-3Po: set an ingest token of at least 24 characters.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!SymbolSelect(_Symbol, true)) return INIT_FAILED;
   SyncHistory();
   EventSetMillisecondTimer(MathMax(100, MinIntervalMs));
   Print("GOLD-3Po bridge ready for ", _Symbol, ". Live quotes enabled.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
{
   ulong nowMs = GetTickCount64();
   if(lastSentAt != 0 && nowMs - lastSentAt < (ulong)MathMax(10, MinIntervalMs)) return;
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.bid <= 0 || tick.ask < tick.bid) return;
   lastSentAt = nowMs;
   sequenceNumber++;
   GlobalVariableSet(sequenceKey, (double)sequenceNumber);
   double lastPrice = tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2.0;
   string body = StringFormat(
      "{\"source\":\"mt5\",\"symbol\":\"%s\",\"timestamp\":\"%s\",\"sequence\":%I64u,\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"tickVolume\":%I64u,\"realVolume\":%.4f,\"flags\":%u}",
      _Symbol, TickStamp(tick.time_msc), sequenceNumber, tick.bid, tick.ask, lastPrice, tick.volume, tick.volume_real, tick.flags
   );
   if(!PostJson(IngestUrl, body))
      Print("GOLD-3Po: live quote delivery failed. Check MT5 WebRequest allowlist and API health.");
}
