#property strict
#property version "1.00"
#property description "GOLD-3Po MT5 quote bridge. Sends broker ticks; does not claim exchange trade volume."

input string IngestUrl = "http://127.0.0.1:8787/v1/ingest/mt5/tick";
input string IngestToken = "";
input int MinIntervalMs = 100;
input int RequestTimeoutMs = 1500;

ulong sequenceNumber = 0;
ulong lastSentAt = 0;
int lastHttpStatus = 0;

int OnInit()
{
   sequenceNumber = (ulong)TimeGMT() * 1000;
   if(StringLen(IngestToken) < 24)
   {
      Print("GOLD-3Po: set an ingest token of at least 24 characters.");
      return INIT_PARAMETERS_INCORRECT;
   }
   Print("GOLD-3Po bridge ready for ", _Symbol, ". Add the ingest URL to MT5 WebRequest allowed URLs.");
   return INIT_SUCCEEDED;
}

void OnTick()
{
   ulong nowMs = GetTickCount64();
   if(lastSentAt != 0 && nowMs - lastSentAt < (ulong)MathMax(10, MinIntervalMs)) return;
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.bid <= 0 || tick.ask < tick.bid) return;
   lastSentAt = nowMs;
   sequenceNumber++;
   double lastPrice = tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2.0;
   string stamp = TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS);
   StringReplace(stamp, ".", "-");
   StringReplace(stamp, " ", "T");
   stamp += "Z";
   string body = StringFormat(
      "{\"source\":\"mt5\",\"symbol\":\"%s\",\"timestamp\":\"%s\",\"sequence\":%I64u,\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"tickVolume\":%I64u,\"realVolume\":%.4f}",
      _Symbol, stamp, sequenceNumber, tick.bid, tick.ask, lastPrice, tick.volume, tick.volume_real
   );
   char data[];
   int copied = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(copied > 0) ArrayResize(data, copied - 1);
   char result[];
   string responseHeaders;
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + IngestToken + "\r\n";
   lastHttpStatus = WebRequest("POST", IngestUrl, headers, RequestTimeoutMs, data, result, responseHeaders);
   if(lastHttpStatus != 202)
      Print("GOLD-3Po bridge: WebRequest status=", lastHttpStatus, " error=", GetLastError(), ". Check terminal URL allowlist and API health.");
}
