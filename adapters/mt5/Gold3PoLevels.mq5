#property strict
#property indicator_chart_window
#property indicator_buffers 0
#property indicator_plots 0
#property description "Draws GOLD-3Po reaction zones from MT5 Common Files. Colours, line style and labels come from the app settings."

input string          InpBrokerSymbol   = "";           // Blank uses the current chart symbol
input int             InpPollSeconds    = 2;            // Timer interval (seconds)
input int             InpStaleSeconds   = 180;          // Maximum snapshot age (seconds)
input int             InpMaxZones       = 20;           // Draw at most this many zones (1..20); the app decides the count
input bool            InpUseAppStyle    = true;         // Use colours/line style set in the GOLD-3Po app
input color           InpBuySideColor   = clrRed;       // Zones above price (when not using app style)
input color           InpSellSideColor  = clrRed;       // Zones below price (when not using app style)
input ENUM_LINE_STYLE InpLineStyle      = STYLE_SOLID;  // Line style (when not using app style)
input int             InpLineWidth      = 2;            // Line width 1..5 (when not using app style)

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
   string label;
};

struct GoldStyle
{
   color           buy;
   color           sell;
   ENUM_LINE_STYLE line;
   int             width;
   bool            fill;
   bool            labels;
   bool            strength;
};

string    g_symbol;
string    g_file;
string    g_prefix;
GoldZone  g_zones[G3P_MAX_ZONES];
GoldStyle g_style;
int       g_zone_count = 0;
int       g_rendered_count = 0;
long      g_latest_stamp = 0;

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

void InputStyle(GoldStyle &style)
{
   style.buy = InpBuySideColor;
   style.sell = InpSellSideColor;
   style.line = InpLineStyle;
   style.width = InpLineStyle == STYLE_SOLID ? InpLineWidth : 1; // MT5 draws dashes only at width 1
   style.fill = false;
   style.labels = true;
   style.strength = true;
}

int HexDigit(const ushort c)
{
   if(c >= '0' && c <= '9')
      return c - '0';
   if(c >= 'A' && c <= 'F')
      return c - 'A' + 10;
   if(c >= 'a' && c <= 'f')
      return c - 'a' + 10;
   return -1;
}

// "#RRGGBB" -> MQL color (0x00BBGGRR).
bool HexColor(const string text, color &out)
{
   if(StringLen(text) != 7 || StringGetCharacter(text, 0) != '#')
      return false;
   int rgb[3];
   for(int k = 0; k < 3; ++k)
   {
      const int hi = HexDigit(StringGetCharacter(text, 1 + k * 2));
      const int lo = HexDigit(StringGetCharacter(text, 2 + k * 2));
      if(hi < 0 || lo < 0)
         return false;
      rgb[k] = hi * 16 + lo;
   }
   out = (color)(rgb[0] | (rgb[1] << 8) | (rgb[2] << 16));
   return true;
}

bool LineStyleToken(const string text, ENUM_LINE_STYLE &out)
{
   if(text == "SOLID")           out = STYLE_SOLID;
   else if(text == "DASH")       out = STYLE_DASH;
   else if(text == "DOT")        out = STYLE_DOT;
   else if(text == "DASHDOT")    out = STYLE_DASHDOT;
   else if(text == "DASHDOTDOT") out = STYLE_DASHDOTDOT;
   else return false;
   return true;
}

bool Flag(const string text, bool &out)
{
   if(text == "1") { out = true; return true; }
   if(text == "0") { out = false; return true; }
   return false;
}

bool ParseStyle(const string line, GoldStyle &style)
{
   string f[];
   long width = 0;
   if(StringSplit(line, ',', f) != 8 || f[0] != "STYLE")
      return false;
   color buy = clrRed, sell = clrRed;
   ENUM_LINE_STYLE line = STYLE_SOLID;
   bool fill = false, labels = true, strength = true;
   if(!HexColor(f[1], buy) || !HexColor(f[2], sell) || !LineStyleToken(f[3], line))
      return false;
   if(!UnsignedDecimal(f[4], 1, width) || width < 1 || width > 5)
      return false;
   if(!Flag(f[5], fill) || !Flag(f[6], labels) || !Flag(f[7], strength))
      return false;
   style.buy = buy;
   style.sell = sell;
   style.line = line;
   style.width = line == STYLE_SOLID ? (int)width : 1;
   style.fill = fill;
   style.labels = labels;
   style.strength = strength;
   return true;
}

// Accepts G3P1 (no style, 6 fields per zone) and G3P2 (STYLE line, 7 fields per zone with a label).
bool ReadSnapshot(GoldZone &zones[], int &count, long &stamp, GoldStyle &style, string &status)
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
   if(StringSplit(lines[0], ',', fields) != 4 || (fields[0] != "G3P1" && fields[0] != "G3P2") ||
      !UnsignedDecimal(fields[1], 12, stamp) || stamp <= 0 ||
      !UnsignedDecimal(fields[3], 2, parsed_count) || parsed_count > G3P_MAX_ZONES)
   {
      status = "Invalid snapshot header";
      return false;
   }
   const bool v2 = fields[0] == "G3P2";
   if(fields[2] != g_symbol)
   {
      status = "Snapshot symbol mismatch (expected " + g_symbol + ")";
      return false;
   }
   count = (int)parsed_count;
   const int first = v2 ? 2 : 1;
   if(used != count + first + 1)
   {
      status = "Invalid snapshot (zone count mismatch)";
      return false;
   }

   InputStyle(style);
   if(v2 && !ParseStyle(lines[1], style))
   {
      status = "Invalid snapshot style line";
      return false;
   }
   if(!InpUseAppStyle)
      InputStyle(style);

   const int expected = v2 ? 7 : 6;
   for(int i = 0; i < count; ++i)
   {
      double low = 0.0, high = 0.0;
      if(StringSplit(lines[i + first], ',', fields) != expected || !TextField(fields[0]) ||
         (fields[1] != "buy-side" && fields[1] != "sell-side") ||
         !PositivePrice(fields[2], low) || !PositivePrice(fields[3], high) ||
         low > high || !TextField(fields[4]) || !TextField(fields[5]) ||
         (v2 && !TextField(fields[6])))
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
      zones[i].low = low;
      zones[i].high = high;
      zones[i].strength = fields[4];
      zones[i].state = fields[5];
      zones[i].label = v2 ? fields[6] : "Zone";
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

// Mix a colour with the chart background: MT5 rectangles have no alpha, so this imitates a translucent fill.
color Blend(const color fg, const color bg, const double share)
{
   const uint a = (uint)fg, b = (uint)bg;
   const int r = (int)MathRound((a & 0xFF) * share + (b & 0xFF) * (1.0 - share));
   const int g = (int)MathRound(((a >> 8) & 0xFF) * share + ((b >> 8) & 0xFF) * (1.0 - share));
   const int bl = (int)MathRound(((a >> 16) & 0xFF) * share + ((b >> 16) & 0xFF) * (1.0 - share));
   return (color)(r | (g << 8) | (bl << 16));
}

void DeleteZoneObjects(const int index)
{
   const string key = g_prefix + IntegerToString(index);
   ObjectDelete(0, key + ":low:line");
   ObjectDelete(0, key + ":high:line");
   ObjectDelete(0, key + ":text");
   ObjectDelete(0, key + ":box");
}

void DrawLine(const string name, const double price, const color line_color, const string tooltip)
{
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   NonInteractive(name);
   ObjectSetInteger(0, name, OBJPROP_COLOR, line_color);
   ObjectSetInteger(0, name, OBJPROP_STYLE, g_style.line);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, g_style.width);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, tooltip);
}

void DrawZones()
{
   const int shown = MathMin(g_zone_count, InpMaxZones);
   for(int i = 0; i < g_rendered_count; ++i)
      if(i >= shown)
         DeleteZoneObjects(i);
   g_rendered_count = shown;
   if(shown == 0)
      return;

   datetime label_time = 0;
   int window = 0;
   double unused_price = 0.0;
   const int chart_width = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS, 0);
   if(chart_width <= 20 || !ChartXYToTimePrice(0, chart_width - 14, 5, window, label_time, unused_price))
      label_time = iTime(_Symbol, _Period, 0);
   const int bars = Bars(_Symbol, _Period);
   const datetime box_start = iTime(_Symbol, _Period, MathMax(0, MathMin(bars - 1, 300)));
   const datetime box_end = iTime(_Symbol, _Period, 0) + PeriodSeconds(_Period) * 60;
   const color background = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);

   for(int i = 0; i < shown; ++i)
   {
      const string key = g_prefix + IntegerToString(i);
      const color line_color = g_zones[i].side == "buy-side" ? g_style.buy : g_style.sell;
      const int percent = (int)MathRound(StringToDouble(g_zones[i].strength) * 100.0);
      string caption = g_zones[i].label + " | " + g_zones[i].state;
      if(g_style.strength)
         caption += " | " + IntegerToString(percent) + "%";
      const string tooltip = g_zones[i].id + " | " + caption + " | " + DoubleToString(g_zones[i].low, _Digits) +
                             " - " + DoubleToString(g_zones[i].high, _Digits);

      DrawLine(key + ":low:line", g_zones[i].low, line_color, tooltip);
      DrawLine(key + ":high:line", g_zones[i].high, line_color, tooltip);

      const string box = key + ":box";
      if(g_style.fill && box_start > 0)
      {
         if(ObjectFind(0, box) < 0)
            ObjectCreate(0, box, OBJ_RECTANGLE, 0, box_start, g_zones[i].low, box_end, g_zones[i].high);
         ObjectMove(0, box, 0, box_start, g_zones[i].low);
         ObjectMove(0, box, 1, box_end, g_zones[i].high);
         NonInteractive(box);
         ObjectSetInteger(0, box, OBJPROP_FILL, true);
         ObjectSetInteger(0, box, OBJPROP_BACK, true);
         ObjectSetInteger(0, box, OBJPROP_COLOR, Blend(line_color, background, 0.22));
         ObjectSetString(0, box, OBJPROP_TOOLTIP, tooltip);
      }
      else
         ObjectDelete(0, box);

      const string text = key + ":text";
      if(g_style.labels && label_time > 0)
      {
         if(ObjectFind(0, text) < 0)
            ObjectCreate(0, text, OBJ_TEXT, 0, label_time, g_zones[i].high);
         ObjectMove(0, text, 0, label_time, g_zones[i].high);
         NonInteractive(text);
         ObjectSetInteger(0, text, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
         ObjectSetInteger(0, text, OBJPROP_FONTSIZE, 8);
         ObjectSetInteger(0, text, OBJPROP_COLOR, line_color);
         ObjectSetString(0, text, OBJPROP_TEXT, caption);
         ObjectSetString(0, text, OBJPROP_TOOLTIP, tooltip);
      }
      else
         ObjectDelete(0, text);
   }
}

void OnTimer()
{
   GoldZone incoming[G3P_MAX_ZONES];
   GoldStyle style;
   InputStyle(style);
   int count = 0;
   long stamp = 0;
   string status;
   bool accepted = ReadSnapshot(incoming, count, stamp, style, status);
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
         g_zones[i].label = incoming[i].label;
      }
      g_zone_count = count;
      g_style.buy = style.buy;
      g_style.sell = style.sell;
      g_style.line = style.line;
      g_style.width = style.width;
      g_style.fill = style.fill;
      g_style.labels = style.labels;
      g_style.strength = style.strength;
      g_latest_stamp = stamp;
      const long age = now >= stamp ? now - stamp : 0;
      SetStatus("Live - " + IntegerToString(MathMin(count, InpMaxZones)) + " zone(s), " + IntegerToString(age) + " s old",
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
   if(InpPollSeconds < 1 || InpStaleSeconds < 1 || InpMaxZones < 1 || InpMaxZones > G3P_MAX_ZONES ||
      InpLineWidth < 1 || InpLineWidth > 5)
   {
      Print("Gold3Po: poll/stale intervals must be positive, max zones within 1..20 and line width within 1..5.");
      return INIT_PARAMETERS_INCORRECT;
   }
   InputStyle(g_style);
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
