#property strict
#property indicator_chart_window
#property indicator_buffers 0
#property indicator_plots 0
#property description "Displays read-only Gold3Po desktop snapshots from MT5 Common Files."

input string InpBrokerSymbol = "";   // Blank uses the current chart symbol
input int    InpPollSeconds = 2;     // Timer interval (seconds)
input int    InpStaleSeconds = 180;  // Maximum snapshot age (seconds)
input int    InpMaxZones = 8;        // Maximum zones to draw (1..20)
input color  InpBuySideColor = clrDeepSkyBlue;
input color  InpSellSideColor = clrTomato;

#define G3P_MAX_ZONES 20
#define G3P_MAX_BYTES 16384
#define G3P_FUTURE_TOLERANCE 30

struct GoldZone
{
   string id;
   string side;
   double low;
   double high;
   string strength;
   string state;
};

string   g_symbol;
string   g_file;
string   g_prefix;
GoldZone g_zones[G3P_MAX_ZONES];
int      g_zone_count = 0;
int      g_rendered_count = 0;
long     g_latest_stamp = 0;

bool IsDigit(const ushort c)
{
   return c >= '0' && c <= '9';
}

bool SafeBrokerSymbol(const string symbol)
{
   const int n = StringLen(symbol);
   const int base_length = StringFind(symbol, "XAUUSD") == 0 ? 6 :
                           (StringFind(symbol, "GOLD") == 0 ? 4 : 0);
   // The fixed .csv extension is appended only after the symbol has been validated.
   if(base_length == 0 || n - base_length > 20 || StringFind(symbol, "..") >= 0)
      return false;

   for(int i = base_length; i < n; ++i)
   {
      const ushort c = StringGetCharacter(symbol, i);
      if((c >= 'A' && c <= 'Z') || IsDigit(c) || c == '.' || c == '_' ||
         c == '-' || c == '#' || c == '+')
         continue;
      return false;
   }
   return true;
}

bool UnsignedDecimal(const string text, const int max_digits, long &value)
{
   const int n = StringLen(text);
   if(n < 1 || n > max_digits)
      return false;
   value = 0;
   for(int i = 0; i < n; ++i)
   {
      const ushort c = StringGetCharacter(text, i);
      if(!IsDigit(c))
         return false;
      value = value * 10 + (c - '0');
   }
   return true;
}

// Check the full decimal token before conversion (StringToDouble can accept a prefix).
bool PositivePrice(const string text, double &price)
{
   const int n = StringLen(text);
   if(n == 0 || n > 64)
      return false;
   int i = StringGetCharacter(text, 0) == '+' ? 1 : 0;
   int digits = 0;
   while(i < n && IsDigit(StringGetCharacter(text, i)))
   {
      ++i;
      ++digits;
   }
   if(i < n && StringGetCharacter(text, i) == '.')
   {
      ++i;
      while(i < n && IsDigit(StringGetCharacter(text, i)))
      {
         ++i;
         ++digits;
      }
   }
   if(digits == 0)
      return false;
   if(i < n && (StringGetCharacter(text, i) == 'e' || StringGetCharacter(text, i) == 'E'))
   {
      ++i;
      if(i < n && (StringGetCharacter(text, i) == '+' || StringGetCharacter(text, i) == '-'))
         ++i;
      const int start = i;
      while(i < n && IsDigit(StringGetCharacter(text, i)))
         ++i;
      if(i == start)
         return false;
   }
   if(i != n)
      return false;
   price = StringToDouble(text);
   return MathIsValidNumber(price) && price > 0.0;
}

bool TextField(const string text)
{
   const int n = StringLen(text);
   if(n == 0)
      return false;
   for(int i = 0; i < n; ++i)
   {
      const ushort c = StringGetCharacter(text, i);
      if(c < 32 || c == 127)
         return false;
   }
   string trimmed = text;
   StringTrimLeft(trimmed);
   StringTrimRight(trimmed);
   return StringLen(trimmed) != 0;
}

bool ReadSnapshotText(string &text, string &status)
{
   ResetLastError();
   const int handle = FileOpen(g_file, FILE_READ | FILE_COMMON | FILE_TXT | FILE_ANSI |
                              FILE_SHARE_READ | FILE_SHARE_WRITE, 0, CP_UTF8);
   if(handle == INVALID_HANDLE)
   {
      const int error = GetLastError();
      status = (FileIsExist(g_file, FILE_COMMON) ? "Snapshot unreadable" : "Snapshot missing") +
               " (" + IntegerToString(error) + ")";
      return false;
   }

   const ulong size = FileSize(handle);
   if(size == 0 || size > G3P_MAX_BYTES)
   {
      FileClose(handle);
      status = size == 0 ? "Incomplete snapshot (empty file)" : "Invalid snapshot (file too large)";
      return false;
   }

   // FileReadString may deliver one CRLF record or several LF-only records.
   // Reassemble its chunks with LF separators, then parse logical lines below.
   text = "";
   bool ok = true;
   while(FileTell(handle) < size)
   {
      const ulong before = FileTell(handle);
      ResetLastError();
      string part = FileReadString(handle);
      const int error = GetLastError();
      const ulong after = FileTell(handle);
      if(error != 0 || after <= before || after > size)
      {
         ok = false;
         break;
      }
      text += part;
      const int length = StringLen(part);
      if(length == 0 || StringGetCharacter(part, length - 1) != '\n')
         text += "\n";
   }
   ok = ok && FileSize(handle) == size;
   FileClose(handle);
   if(!ok)
      status = "Incomplete snapshot (file changed or read failed)";
   return ok;
}

bool ReadSnapshot(GoldZone &zones[], int &count, long &stamp, string &status)
{
   string text;
   if(!ReadSnapshotText(text, status))
      return false;
   if(StringLen(text) > 0 && StringGetCharacter(text, 0) == 0xFEFF)
      text = StringSubstr(text, 1);
   StringReplace(text, "\r\n", "\n");

   string lines[];
   const int line_count = StringSplit(text, '\n', lines);
   // Accept a terminal newline (and empty trailing lines), not extra records.
   int used = line_count;
   while(used > 0 && lines[used - 1] == "")
      --used;
   if(used < 2 || lines[used - 1] != "END")
   {
      status = "Incomplete snapshot (missing END)";
      return false;
   }

   string fields[];
   long parsed_count;
   if(StringSplit(lines[0], ',', fields) != 4 || fields[0] != "G3P1" ||
      !UnsignedDecimal(fields[1], 12, stamp) || stamp <= 0 ||
      !UnsignedDecimal(fields[3], 2, parsed_count) || parsed_count > InpMaxZones)
   {
      status = "Invalid snapshot header";
      return false;
   }
   if(fields[2] != g_symbol)
   {
      status = "Snapshot symbol mismatch (expected " + g_symbol + ")";
      return false;
   }
   count = (int)parsed_count;
   if(used != count + 2)
   {
      status = "Invalid snapshot (zone count mismatch)";
      return false;
   }

   for(int i = 0; i < count; ++i)
   {
      if(StringSplit(lines[i + 1], ',', fields) != 6 || !TextField(fields[0]) ||
         (fields[1] != "buy-side" && fields[1] != "sell-side") ||
         !PositivePrice(fields[2], zones[i].low) || !PositivePrice(fields[3], zones[i].high) ||
         zones[i].low > zones[i].high || !TextField(fields[4]) || !TextField(fields[5]))
      {
         status = "Invalid snapshot zone row " + IntegerToString(i + 1);
         return false;
      }
      for(int j = 0; j < i; ++j)
      {
         if(zones[j].id == fields[0])
         {
            status = "Invalid snapshot (duplicate zone ID)";
            return false;
         }
      }
      zones[i].id = fields[0];
      zones[i].side = fields[1];
      zones[i].strength = fields[4];
      zones[i].state = fields[5];
   }
   return true;
}

void NonInteractive(const string name)
{
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

bool ReserveObjectNames()
{
   // Each attached instance owns a separate prefix, reserved by its status label.
   // Check the whole prefix before claiming it, not just the status object.
   const string base = "G3P1:" + IntegerToString((long)GetTickCount64()) + ":";
   for(int slot = 0; slot < 32; ++slot)
   {
      const string candidate = base + IntegerToString(slot) + ":";
      bool available = true;
      const int total = ObjectsTotal(0);
      for(int i = 0; i < total; ++i)
      {
         if(StringFind(ObjectName(0, i), candidate) == 0)
         {
            available = false;
            break;
         }
      }
      if(!available)
         continue;

      const string status = candidate + "status";
      if(!ObjectCreate(0, status, OBJ_LABEL, 0, 0, 0) || ObjectFind(0, status) < 0)
         return false;
      g_prefix = candidate;
      NonInteractive(status);
      ObjectSetInteger(0, status, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, status, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, status, OBJPROP_XDISTANCE, 12);
      ObjectSetInteger(0, status, OBJPROP_YDISTANCE, 24);
      ObjectSetInteger(0, status, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0, status, OBJPROP_TOOLTIP, g_file);
      return true;
   }
   return false;
}

void SetStatus(const string text, const color status_color)
{
   const string name = g_prefix + "status";
   ObjectSetInteger(0, name, OBJPROP_COLOR, status_color);
   ObjectSetString(0, name, OBJPROP_TEXT, "Gold3Po " + g_symbol + ": " + text);
}

void DrawBoundary(const string key, const double price, const color line_color,
                  const datetime label_time, const string label, const string detail,
                  const ENUM_ANCHOR_POINT anchor)
{
   const string line = key + ":line";
   ObjectCreate(0, line, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(0, line, OBJPROP_PRICE, price);
   NonInteractive(line);
   ObjectSetInteger(0, line, OBJPROP_COLOR, line_color);
   ObjectSetInteger(0, line, OBJPROP_STYLE, STYLE_DASH);
   ObjectSetString(0, line, OBJPROP_TEXT, label);
   ObjectSetString(0, line, OBJPROP_TOOLTIP, detail);

   const string caption = key + ":text";
   if(label_time <= 0)
      return;
   ObjectCreate(0, caption, OBJ_TEXT, 0, label_time, price);
   ObjectMove(0, caption, 0, label_time, price);
   NonInteractive(caption);
   ObjectSetInteger(0, caption, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, caption, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, caption, OBJPROP_COLOR, line_color);
   ObjectSetString(0, caption, OBJPROP_TEXT, label);
   ObjectSetString(0, caption, OBJPROP_TOOLTIP, detail);
}

void DrawZones()
{
   for(int i = g_zone_count; i < g_rendered_count; ++i)
   {
      const string key = g_prefix + IntegerToString(i);
      ObjectDelete(0, key + ":low:line");
      ObjectDelete(0, key + ":low:text");
      ObjectDelete(0, key + ":high:line");
      ObjectDelete(0, key + ":high:text");
   }
   g_rendered_count = g_zone_count;
   if(g_zone_count == 0)
      return;

   datetime label_time = 0;
   int window = 0;
   double unused_price = 0.0;
   const int width = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS, 0);
   if(width <= 20 || !ChartXYToTimePrice(0, width - 14, 5, window, label_time, unused_price))
      label_time = iTime(_Symbol, _Period, 0);

   for(int i = 0; i < g_zone_count; ++i)
   {
      const string key = g_prefix + IntegerToString(i);
      const color line_color = g_zones[i].side == "buy-side" ? InpBuySideColor : InpSellSideColor;
      const string label = g_zones[i].side + " " + g_zones[i].id;
      const string detail = label + " | " + g_zones[i].state + " | strength " + g_zones[i].strength;
      DrawBoundary(key + ":low", g_zones[i].low, line_color, label_time, label + " low",
                   detail + " | low", ANCHOR_RIGHT_UPPER);
      DrawBoundary(key + ":high", g_zones[i].high, line_color, label_time, label + " high",
                   detail + " | high", ANCHOR_RIGHT_LOWER);
   }
}

void OnTimer()
{
   GoldZone incoming[G3P_MAX_ZONES];
   int count = 0;
   long stamp = 0;
   string status;
   bool accepted = ReadSnapshot(incoming, count, stamp, status);
   const long now = (long)TimeGMT();
   if(accepted && now <= 0)
   {
      status = "UTC clock unavailable";
      accepted = false;
   }
   if(accepted && stamp > now + G3P_FUTURE_TOLERANCE)
   {
      status = "Snapshot timestamp is in the future (check system clock)";
      accepted = false;
   }
   if(accepted && now - stamp > InpStaleSeconds)
   {
      status = "Snapshot stale (" + IntegerToString(now - stamp) + " s old)";
      accepted = false;
   }
   if(accepted && stamp < g_latest_stamp)
   {
      status = "Older snapshot ignored";
      accepted = false;
   }

   const color foreground = (color)ChartGetInteger(0, CHART_COLOR_FOREGROUND);
   if(accepted)
   {
      for(int i = 0; i < count; ++i)
      {
         g_zones[i].id = incoming[i].id;
         g_zones[i].side = incoming[i].side;
         g_zones[i].low = incoming[i].low;
         g_zones[i].high = incoming[i].high;
         g_zones[i].strength = incoming[i].strength;
         g_zones[i].state = incoming[i].state;
      }
      g_zone_count = count;
      g_latest_stamp = stamp;
      const long age = now >= stamp ? now - stamp : 0;
      SetStatus("Live - " + IntegerToString(count) + " zone(s), " + IntegerToString(age) + " s old",
                foreground);
   }
   else
   {
      // Transient write/open failures never replace a still-fresh accepted snapshot.
      if(g_zone_count > 0 && now > 0 && g_latest_stamp <= now + G3P_FUTURE_TOLERANCE &&
         now - g_latest_stamp <= InpStaleSeconds)
         status += "; showing last valid levels";
      else
      {
         g_zone_count = 0;
         status += "; no levels";
      }
      SetStatus(status, foreground);
   }
   DrawZones();
   ChartRedraw(0);
}

int OnInit()
{
   if(InpPollSeconds < 1 || InpStaleSeconds < 1 || InpMaxZones < 1 || InpMaxZones > G3P_MAX_ZONES)
   {
      Print("Gold3Po: poll/stale intervals must be positive and max zones within 1..20.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_symbol = InpBrokerSymbol == "" ? _Symbol : InpBrokerSymbol;
   if(!StringToUpper(g_symbol) || !SafeBrokerSymbol(g_symbol))
   {
      Print("Gold3Po: invalid broker symbol; use XAUUSD or GOLD with an optional safe suffix.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_file = "GOLD3PO\\" + g_symbol + ".csv";
   IndicatorSetString(INDICATOR_SHORTNAME, "Gold3Po Levels (" + g_symbol + ")");
   if(!ReserveObjectNames())
   {
      Print("Gold3Po: could not reserve chart objects.");
      return INIT_FAILED;
   }
   if(!EventSetTimer(InpPollSeconds))
   {
      Print("Gold3Po: could not start the polling timer: ", GetLastError());
      return INIT_FAILED;
   }
   OnTimer();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_prefix != "")
   {
      ObjectsDeleteAll(0, g_prefix);
      ChartRedraw(0);
   }
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[],
                const double &close[], const long &tick_volume[], const long &volume[],
                const int &spread[])
{
   return rates_total;
}
