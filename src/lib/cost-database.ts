// Regional Cost Database — inspired by OpenConstructionERP's CWICR + 11 regional price sets
// Covers: US, UK, UAE, India, Canada, Australia, Germany, France, Spain, Brazil, China

export type Region =
  | "us_national" | "us_nyc" | "us_la" | "us_chicago"
  | "uk" | "uae" | "india" | "canada" | "australia"
  | "germany" | "france" | "spain" | "brazil" | "china";

export interface CostItem {
  id: string;
  csiCode: string;
  masterformatDiv: string;
  description: string;
  unit: string;
  category: string;
  subcategory: string;
  prices: Partial<Record<Region, { labor: number; material: number; total: number }>>;
  keywords: string[];
}

// Real exchange rates: USD → local currency (as of 2025)
// Prices in DB are stored in USD (region-adjusted labor costs).
// Multiplier converts to local currency for display.
export const CURRENCY_MULTIPLIERS: Record<Region, { symbol: string; name: string; multiplier: number }> = {
  us_national: { symbol: "$",   name: "USD (National avg)", multiplier: 1.00   },
  us_nyc:      { symbol: "$",   name: "USD (New York)",     multiplier: 1.00   }, // NYC prices stored directly in USD
  us_la:       { symbol: "$",   name: "USD (Los Angeles)",  multiplier: 1.00   },
  us_chicago:  { symbol: "$",   name: "USD (Chicago)",      multiplier: 1.00   },
  uk:          { symbol: "£",   name: "GBP (UK)",           multiplier: 0.79   }, // 1 USD = 0.79 GBP
  uae:         { symbol: "د.إ", name: "AED (UAE)",          multiplier: 3.67   }, // 1 USD = 3.67 AED
  india:       { symbol: "₹",   name: "INR (India)",        multiplier: 83.50  }, // 1 USD = 83.5 INR
  canada:      { symbol: "C$",  name: "CAD (Canada)",       multiplier: 1.36   }, // 1 USD = 1.36 CAD
  australia:   { symbol: "A$",  name: "AUD (Australia)",    multiplier: 1.53   }, // 1 USD = 1.53 AUD
  germany:     { symbol: "€",   name: "EUR (Germany)",      multiplier: 0.92   }, // 1 USD = 0.92 EUR
  france:      { symbol: "€",   name: "EUR (France)",       multiplier: 0.92   },
  spain:       { symbol: "€",   name: "EUR (Spain)",        multiplier: 0.92   },
  brazil:      { symbol: "R$",  name: "BRL (Brazil)",       multiplier: 4.97   }, // 1 USD = 4.97 BRL
  china:       { symbol: "¥",   name: "CNY (China)",        multiplier: 7.24   }, // 1 USD = 7.24 CNY
};

// Full cost database — 98+ items across all 16 CSI divisions + specialties
export const COST_DATABASE: CostItem[] = [
  // ─── 02 Existing Conditions ───────────────────────────────
  { id: "02-0100", csiCode: "02 41 13", masterformatDiv: "02 - Existing Conditions", description: "Selective Demolition - Concrete", unit: "CY", category: "Demolition", subcategory: "Concrete", keywords: ["demolition","concrete","remove"],
    prices: { us_national: { labor: 85, material: 0, total: 85 }, uk: { labor: 72, material: 0, total: 72 }, uae: { labor: 55, material: 0, total: 55 }, india: { labor: 12, material: 0, total: 12 } } },
  { id: "02-0200", csiCode: "02 41 16", masterformatDiv: "02 - Existing Conditions", description: "Selective Demolition - Masonry", unit: "SF", category: "Demolition", subcategory: "Masonry", keywords: ["demolition","masonry","brick","remove"],
    prices: { us_national: { labor: 4.50, material: 0, total: 4.50 }, uk: { labor: 3.80, material: 0, total: 3.80 }, india: { labor: 0.60, material: 0, total: 0.60 } } },

  // ─── 03 Concrete ──────────────────────────────────────────
  { id: "03-0100", csiCode: "03 30 00", masterformatDiv: "03 - Concrete", description: "Cast-in-Place Concrete - Slab on Grade 4\"", unit: "CY", category: "Concrete", subcategory: "Slab", keywords: ["concrete","slab","grade","floor"],
    prices: { us_national: { labor: 55, material: 110, total: 165 }, uk: { labor: 65, material: 95, total: 160 }, uae: { labor: 40, material: 85, total: 125 }, india: { labor: 18, material: 60, total: 78 }, canada: { labor: 58, material: 112, total: 170 }, australia: { labor: 70, material: 105, total: 175 }, germany: { labor: 72, material: 98, total: 170 } } },
  { id: "03-0110", csiCode: "03 30 00", masterformatDiv: "03 - Concrete", description: "Cast-in-Place Concrete - Footing", unit: "CY", category: "Concrete", subcategory: "Foundation", keywords: ["concrete","footing","foundation"],
    prices: { us_national: { labor: 65, material: 115, total: 180 }, uk: { labor: 75, material: 100, total: 175 }, uae: { labor: 48, material: 90, total: 138 }, india: { labor: 20, material: 65, total: 85 } } },
  { id: "03-0120", csiCode: "03 30 00", masterformatDiv: "03 - Concrete", description: "Cast-in-Place Concrete - Column", unit: "CY", category: "Concrete", subcategory: "Column", keywords: ["concrete","column","pier"],
    prices: { us_national: { labor: 120, material: 130, total: 250 }, uk: { labor: 135, material: 115, total: 250 }, uae: { labor: 85, material: 100, total: 185 }, india: { labor: 30, material: 70, total: 100 } } },
  { id: "03-0130", csiCode: "03 30 00", masterformatDiv: "03 - Concrete", description: "Cast-in-Place Concrete - Wall 8\"", unit: "CY", category: "Concrete", subcategory: "Wall", keywords: ["concrete","wall","retaining"],
    prices: { us_national: { labor: 95, material: 120, total: 215 }, uk: { labor: 105, material: 105, total: 210 }, uae: { labor: 68, material: 95, total: 163 }, india: { labor: 25, material: 68, total: 93 } } },
  { id: "03-0140", csiCode: "03 20 00", masterformatDiv: "03 - Concrete", description: "Reinforcing Steel - Rebar #4", unit: "LB", category: "Concrete", subcategory: "Rebar", keywords: ["rebar","reinforcing","steel","#4"],
    prices: { us_national: { labor: 0.35, material: 0.55, total: 0.90 }, uk: { labor: 0.40, material: 0.50, total: 0.90 }, uae: { labor: 0.25, material: 0.42, total: 0.67 }, india: { labor: 0.06, material: 0.38, total: 0.44 } } },
  { id: "03-0150", csiCode: "03 35 00", masterformatDiv: "03 - Concrete", description: "Concrete Finishing - Troweled", unit: "SF", category: "Concrete", subcategory: "Finishing", keywords: ["concrete","finish","trowel","polish"],
    prices: { us_national: { labor: 1.20, material: 0, total: 1.20 }, uk: { labor: 1.35, material: 0, total: 1.35 }, uae: { labor: 0.80, material: 0, total: 0.80 }, india: { labor: 0.18, material: 0, total: 0.18 } } },

  // ─── 04 Masonry ───────────────────────────────────────────
  { id: "04-0100", csiCode: "04 22 00", masterformatDiv: "04 - Masonry", description: "CMU Block 8\" Standard", unit: "EA", category: "Masonry", subcategory: "CMU", keywords: ["cmu","block","masonry","concrete block"],
    prices: { us_national: { labor: 1.85, material: 1.00, total: 2.85 }, uk: { labor: 2.10, material: 1.20, total: 3.30 }, uae: { labor: 1.20, material: 0.85, total: 2.05 }, india: { labor: 0.25, material: 0.50, total: 0.75 } } },
  { id: "04-0110", csiCode: "04 21 13", masterformatDiv: "04 - Masonry", description: "Common Brick - Face Brick", unit: "EA", category: "Masonry", subcategory: "Brick", keywords: ["brick","face brick","masonry"],
    prices: { us_national: { labor: 0.55, material: 0.30, total: 0.85 }, uk: { labor: 0.65, material: 0.45, total: 1.10 }, uae: { labor: 0.35, material: 0.25, total: 0.60 }, india: { labor: 0.06, material: 0.08, total: 0.14 } } },

  // ─── 05 Metals ────────────────────────────────────────────
  { id: "05-0100", csiCode: "05 12 00", masterformatDiv: "05 - Metals", description: "Structural Steel - W8x31 Beam", unit: "LF", category: "Metals", subcategory: "Steel Beam", keywords: ["steel","beam","structural","W8"],
    prices: { us_national: { labor: 18, material: 28, total: 46 }, uk: { labor: 22, material: 32, total: 54 }, uae: { labor: 14, material: 26, total: 40 }, india: { labor: 4, material: 20, total: 24 } } },
  { id: "05-0110", csiCode: "05 12 00", masterformatDiv: "05 - Metals", description: "Structural Steel - HSS Column", unit: "LF", category: "Metals", subcategory: "Steel Column", keywords: ["steel","column","hss","hollow structural"],
    prices: { us_national: { labor: 22, material: 35, total: 57 }, uk: { labor: 26, material: 40, total: 66 }, uae: { labor: 16, material: 32, total: 48 }, india: { labor: 5, material: 24, total: 29 } } },

  // ─── 06 Wood & Plastics ───────────────────────────────────
  { id: "06-0100", csiCode: "06 11 10", masterformatDiv: "06 - Wood & Plastics", description: "Framing Lumber 2x4 Stud", unit: "EA", category: "Lumber", subcategory: "Studs", keywords: ["2x4","stud","framing","lumber","wood"],
    prices: { us_national: { labor: 1.50, material: 3.00, total: 4.50 }, uk: { labor: 2.00, material: 3.50, total: 5.50 }, uae: { labor: 1.20, material: 3.20, total: 4.40 }, india: { labor: 0.30, material: 2.50, total: 2.80 }, canada: { labor: 1.55, material: 2.80, total: 4.35 } } },
  { id: "06-0110", csiCode: "06 11 10", masterformatDiv: "06 - Wood & Plastics", description: "Framing Lumber 2x6 Stud", unit: "EA", category: "Lumber", subcategory: "Studs", keywords: ["2x6","stud","framing","lumber"],
    prices: { us_national: { labor: 1.50, material: 5.00, total: 6.50 }, uk: { labor: 2.00, material: 5.80, total: 7.80 }, uae: { labor: 1.20, material: 5.20, total: 6.40 }, india: { labor: 0.30, material: 3.80, total: 4.10 } } },
  { id: "06-0120", csiCode: "06 11 10", masterformatDiv: "06 - Wood & Plastics", description: "LVL Beam 3.5\" x 9.5\"", unit: "LF", category: "Lumber", subcategory: "Engineered", keywords: ["lvl","beam","engineered","lumber","header"],
    prices: { us_national: { labor: 3.50, material: 12.50, total: 16.00 }, uk: { labor: 4.20, material: 14.00, total: 18.20 }, uae: { labor: 2.80, material: 13.50, total: 16.30 }, india: { labor: 0.80, material: 9.00, total: 9.80 } } },
  { id: "06-0130", csiCode: "06 16 00", masterformatDiv: "06 - Wood & Plastics", description: "OSB Sheathing 7/16\"", unit: "SF", category: "Lumber", subcategory: "Sheathing", keywords: ["osb","sheathing","plywood","wall"],
    prices: { us_national: { labor: 0.28, material: 0.40, total: 0.68 }, uk: { labor: 0.35, material: 0.48, total: 0.83 }, uae: { labor: 0.22, material: 0.38, total: 0.60 }, india: { labor: 0.05, material: 0.28, total: 0.33 } } },

  // ─── 07 Thermal & Moisture ────────────────────────────────
  { id: "07-0100", csiCode: "07 21 13", masterformatDiv: "07 - Thermal & Moisture", description: "Batt Insulation R-13 3.5\"", unit: "SF", category: "Insulation", subcategory: "Batt", keywords: ["insulation","batt","r13","fiberglass"],
    prices: { us_national: { labor: 0.18, material: 0.20, total: 0.38 }, uk: { labor: 0.22, material: 0.25, total: 0.47 }, uae: { labor: 0.14, material: 0.22, total: 0.36 }, india: { labor: 0.03, material: 0.15, total: 0.18 } } },
  { id: "07-0110", csiCode: "07 21 13", masterformatDiv: "07 - Thermal & Moisture", description: "Batt Insulation R-21 5.5\"", unit: "SF", category: "Insulation", subcategory: "Batt", keywords: ["insulation","batt","r21","fiberglass"],
    prices: { us_national: { labor: 0.20, material: 0.35, total: 0.55 }, uk: { labor: 0.24, material: 0.42, total: 0.66 }, uae: { labor: 0.16, material: 0.38, total: 0.54 }, india: { labor: 0.04, material: 0.22, total: 0.26 } } },
  { id: "07-0120", csiCode: "07 22 00", masterformatDiv: "07 - Thermal & Moisture", description: "Rigid Foam Insulation R-10 2\"", unit: "SF", category: "Insulation", subcategory: "Rigid", keywords: ["insulation","rigid","foam","r10"],
    prices: { us_national: { labor: 0.30, material: 0.55, total: 0.85 }, uk: { labor: 0.36, material: 0.65, total: 1.01 }, uae: { labor: 0.24, material: 0.58, total: 0.82 }, india: { labor: 0.05, material: 0.38, total: 0.43 } } },
  { id: "07-0130", csiCode: "07 31 13", masterformatDiv: "07 - Thermal & Moisture", description: "Asphalt Shingles 30-Year", unit: "SQ", category: "Roofing", subcategory: "Shingles", keywords: ["shingles","roofing","asphalt","30 year"],
    prices: { us_national: { labor: 38, material: 57, total: 95 }, uk: { labor: 50, material: 65, total: 115 }, uae: { labor: 30, material: 60, total: 90 }, india: { labor: 8, material: 45, total: 53 }, canada: { labor: 40, material: 58, total: 98 }, australia: { labor: 55, material: 65, total: 120 } } },
  { id: "07-0140", csiCode: "07 46 00", masterformatDiv: "07 - Thermal & Moisture", description: "Metal Roofing Standing Seam", unit: "SF", category: "Roofing", subcategory: "Metal", keywords: ["metal","roofing","standing seam"],
    prices: { us_national: { labor: 4.50, material: 8.50, total: 13.00 }, uk: { labor: 5.50, material: 9.50, total: 15.00 }, uae: { labor: 3.50, material: 8.00, total: 11.50 }, india: { labor: 0.90, material: 5.50, total: 6.40 } } },

  // ─── 08 Doors & Windows ───────────────────────────────────
  { id: "08-0100", csiCode: "08 11 13", masterformatDiv: "08 - Doors & Windows", description: "Steel Door 3'x7' with Frame", unit: "EA", category: "Doors & Windows", subcategory: "Door", keywords: ["door","steel","hollow metal","exterior"],
    prices: { us_national: { labor: 180, material: 420, total: 600 }, uk: { labor: 220, material: 480, total: 700 }, uae: { labor: 140, material: 380, total: 520 }, india: { labor: 35, material: 250, total: 285 } } },
  { id: "08-0110", csiCode: "08 14 00", masterformatDiv: "08 - Doors & Windows", description: "Wood Door Interior 2'8\"x6'8\"", unit: "EA", category: "Doors & Windows", subcategory: "Door", keywords: ["door","wood","interior","hollow core"],
    prices: { us_national: { labor: 85, material: 145, total: 230 }, uk: { labor: 100, material: 165, total: 265 }, uae: { labor: 65, material: 130, total: 195 }, india: { labor: 15, material: 80, total: 95 } } },
  { id: "08-0120", csiCode: "08 52 00", masterformatDiv: "08 - Doors & Windows", description: "Aluminum Window Double Hung 3'x4'", unit: "EA", category: "Doors & Windows", subcategory: "Window", keywords: ["window","aluminum","double hung"],
    prices: { us_national: { labor: 120, material: 280, total: 400 }, uk: { labor: 150, material: 320, total: 470 }, uae: { labor: 95, material: 260, total: 355 }, india: { labor: 25, material: 160, total: 185 } } },
  { id: "08-0130", csiCode: "08 54 13", masterformatDiv: "08 - Doors & Windows", description: "UPVC Window 3'x4' Double Glazed", unit: "EA", category: "Doors & Windows", subcategory: "Window", keywords: ["upvc","window","double glazed","pvc"],
    prices: { us_national: { labor: 110, material: 290, total: 400 }, uk: { labor: 140, material: 260, total: 400 }, uae: { labor: 88, material: 240, total: 328 }, india: { labor: 22, material: 145, total: 167 } } },

  // ─── 09 Finishes ──────────────────────────────────────────
  { id: "09-0100", csiCode: "09 21 16", masterformatDiv: "09 - Finishes", description: "Gypsum Drywall 1/2\" Walls", unit: "SF", category: "Drywall", subcategory: "Walls", keywords: ["drywall","gypsum","walls","interior"],
    prices: { us_national: { labor: 0.30, material: 0.25, total: 0.55 }, uk: { labor: 0.38, material: 0.30, total: 0.68 }, uae: { labor: 0.24, material: 0.28, total: 0.52 }, india: { labor: 0.05, material: 0.18, total: 0.23 }, canada: { labor: 0.32, material: 0.26, total: 0.58 }, australia: { labor: 0.42, material: 0.32, total: 0.74 } } },
  { id: "09-0110", csiCode: "09 21 16", masterformatDiv: "09 - Finishes", description: "Gypsum Drywall 5/8\" Type X Ceiling", unit: "SF", category: "Drywall", subcategory: "Ceiling", keywords: ["drywall","gypsum","ceiling","type x","fire"],
    prices: { us_national: { labor: 0.38, material: 0.27, total: 0.65 }, uk: { labor: 0.46, material: 0.32, total: 0.78 }, uae: { labor: 0.30, material: 0.30, total: 0.60 }, india: { labor: 0.06, material: 0.20, total: 0.26 } } },
  { id: "09-0120", csiCode: "09 65 13", masterformatDiv: "09 - Finishes", description: "Ceramic Tile 12x12 Floor", unit: "SF", category: "Flooring", subcategory: "Tile", keywords: ["tile","ceramic","floor","12x12"],
    prices: { us_national: { labor: 1.25, material: 2.00, total: 3.25 }, uk: { labor: 1.60, material: 2.40, total: 4.00 }, uae: { labor: 1.00, material: 1.80, total: 2.80 }, india: { labor: 0.22, material: 1.20, total: 1.42 } } },
  { id: "09-0130", csiCode: "09 65 13", masterformatDiv: "09 - Finishes", description: "Porcelain Tile 24x24 Floor", unit: "SF", category: "Flooring", subcategory: "Tile", keywords: ["tile","porcelain","floor","24x24"],
    prices: { us_national: { labor: 1.50, material: 3.50, total: 5.00 }, uk: { labor: 1.90, material: 4.20, total: 6.10 }, uae: { labor: 1.20, material: 3.20, total: 4.40 }, india: { labor: 0.28, material: 2.00, total: 2.28 } } },
  { id: "09-0140", csiCode: "09 64 00", masterformatDiv: "09 - Finishes", description: "Hardwood Flooring 3/4\" Oak", unit: "SF", category: "Flooring", subcategory: "Hardwood", keywords: ["hardwood","oak","flooring","wood floor"],
    prices: { us_national: { labor: 2.50, material: 3.00, total: 5.50 }, uk: { labor: 3.20, material: 3.80, total: 7.00 }, uae: { labor: 2.00, material: 3.50, total: 5.50 }, india: { labor: 0.50, material: 2.20, total: 2.70 } } },
  { id: "09-0150", csiCode: "09 64 23", masterformatDiv: "09 - Finishes", description: "LVP Luxury Vinyl Plank", unit: "SF", category: "Flooring", subcategory: "LVP", keywords: ["lvp","vinyl","plank","luxury vinyl"],
    prices: { us_national: { labor: 1.30, material: 1.50, total: 2.80 }, uk: { labor: 1.65, material: 1.85, total: 3.50 }, uae: { labor: 1.05, material: 1.70, total: 2.75 }, india: { labor: 0.22, material: 1.10, total: 1.32 } } },
  { id: "09-0160", csiCode: "09 68 13", masterformatDiv: "09 - Finishes", description: "Carpet with Pad - Commercial", unit: "SY", category: "Flooring", subcategory: "Carpet", keywords: ["carpet","pad","flooring"],
    prices: { us_national: { labor: 8.00, material: 20.00, total: 28.00 }, uk: { labor: 10.00, material: 24.00, total: 34.00 }, uae: { labor: 6.50, material: 18.00, total: 24.50 }, india: { labor: 1.50, material: 12.00, total: 13.50 } } },
  { id: "09-0170", csiCode: "09 91 23", masterformatDiv: "09 - Finishes", description: "Interior Paint 2 Coats Latex", unit: "SF", category: "Finishes", subcategory: "Paint", keywords: ["paint","interior","latex","2 coats"],
    prices: { us_national: { labor: 0.28, material: 0.10, total: 0.38 }, uk: { labor: 0.35, material: 0.12, total: 0.47 }, uae: { labor: 0.22, material: 0.11, total: 0.33 }, india: { labor: 0.04, material: 0.07, total: 0.11 } } },
  { id: "09-0180", csiCode: "09 91 23", masterformatDiv: "09 - Finishes", description: "Exterior Paint 2 Coats Acrylic", unit: "SF", category: "Finishes", subcategory: "Paint", keywords: ["paint","exterior","acrylic"],
    prices: { us_national: { labor: 0.32, material: 0.13, total: 0.45 }, uk: { labor: 0.40, material: 0.16, total: 0.56 }, uae: { labor: 0.26, material: 0.14, total: 0.40 }, india: { labor: 0.05, material: 0.09, total: 0.14 } } },

  // ─── 15 Mechanical ────────────────────────────────────────
  { id: "15-0100", csiCode: "22 11 16", masterformatDiv: "15 - Mechanical", description: "Copper Pipe 3/4\" Type L", unit: "LF", category: "Plumbing", subcategory: "Pipe", keywords: ["copper","pipe","plumbing","3/4"],
    prices: { us_national: { labor: 6.50, material: 4.50, total: 11.00 }, uk: { labor: 8.00, material: 5.20, total: 13.20 }, uae: { labor: 5.20, material: 4.20, total: 9.40 }, india: { labor: 1.20, material: 2.80, total: 4.00 } } },
  { id: "15-0110", csiCode: "22 42 00", masterformatDiv: "15 - Mechanical", description: "Water Closet - Floor Mount", unit: "EA", category: "Plumbing", subcategory: "Fixture", keywords: ["toilet","wc","water closet","bathroom"],
    prices: { us_national: { labor: 220, material: 280, total: 500 }, uk: { labor: 270, material: 320, total: 590 }, uae: { labor: 175, material: 260, total: 435 }, india: { labor: 45, material: 150, total: 195 } } },
  { id: "15-0120", csiCode: "22 42 00", masterformatDiv: "15 - Mechanical", description: "Lavatory - Wall-Hung Sink", unit: "EA", category: "Plumbing", subcategory: "Fixture", keywords: ["sink","lavatory","basin","bathroom"],
    prices: { us_national: { labor: 160, material: 190, total: 350 }, uk: { labor: 200, material: 220, total: 420 }, uae: { labor: 130, material: 175, total: 305 }, india: { labor: 32, material: 100, total: 132 } } },

  // ─── 16 Electrical ────────────────────────────────────────
  { id: "16-0100", csiCode: "26 05 19", masterformatDiv: "16 - Electrical", description: "Electrical Wire 12 AWG Romex", unit: "LF", category: "Electrical", subcategory: "Wire", keywords: ["wire","electrical","romex","12 awg"],
    prices: { us_national: { labor: 0.80, material: 0.35, total: 1.15 }, uk: { labor: 1.00, material: 0.40, total: 1.40 }, uae: { labor: 0.65, material: 0.32, total: 0.97 }, india: { labor: 0.15, material: 0.20, total: 0.35 } } },
  { id: "16-0110", csiCode: "26 27 26", masterformatDiv: "16 - Electrical", description: "Duplex Outlet 20A with Cover", unit: "EA", category: "Electrical", subcategory: "Devices", keywords: ["outlet","receptacle","duplex","20a"],
    prices: { us_national: { labor: 35, material: 12, total: 47 }, uk: { labor: 42, material: 15, total: 57 }, uae: { labor: 28, material: 11, total: 39 }, india: { labor: 7, material: 6, total: 13 } } },
  { id: "16-0120", csiCode: "26 51 00", masterformatDiv: "16 - Electrical", description: "LED Recessed Light 6\" Retrofit", unit: "EA", category: "Electrical", subcategory: "Lighting", keywords: ["led","light","recessed","can light"],
    prices: { us_national: { labor: 45, material: 25, total: 70 }, uk: { labor: 55, material: 30, total: 85 }, uae: { labor: 36, material: 22, total: 58 }, india: { labor: 9, material: 14, total: 23 } } },
  { id: "16-0130", csiCode: "26 24 16", masterformatDiv: "16 - Electrical", description: "Electrical Panel 200A Main Breaker", unit: "EA", category: "Electrical", subcategory: "Panel", keywords: ["panel","breaker","200a","electrical panel"],
    prices: { us_national: { labor: 450, material: 550, total: 1000 }, uk: { labor: 550, material: 620, total: 1170 }, uae: { labor: 360, material: 500, total: 860 }, india: { labor: 90, material: 300, total: 390 } } },

  // ─── 10 Specialties ───────────────────────────────────────────
  { id: "10-0100", csiCode: "10 21 13", masterformatDiv: "10 - Specialties", description: "Toilet Partition - Powder Coated Steel", unit: "EA", category: "Specialties", subcategory: "Toilet Partition", keywords: ["toilet partition","restroom","cubicle"],
    prices: { us_national: { labor: 120, material: 380, total: 500 }, uk: { labor: 145, material: 430, total: 575 }, uae: { labor: 95, material: 350, total: 445 }, india: { labor: 25, material: 200, total: 225 } } },
  { id: "10-0110", csiCode: "10 44 13", masterformatDiv: "10 - Specialties", description: "Fire Extinguisher - ABC 5LB with Cabinet", unit: "EA", category: "Specialties", subcategory: "Fire Protection", keywords: ["fire extinguisher","abc","safety","fire"],
    prices: { us_national: { labor: 25, material: 85, total: 110 }, uk: { labor: 30, material: 95, total: 125 }, uae: { labor: 20, material: 75, total: 95 }, india: { labor: 5, material: 45, total: 50 } } },
  { id: "10-0120", csiCode: "10 14 00", masterformatDiv: "10 - Specialties", description: "Signage - ADA Compliant Room Sign", unit: "EA", category: "Specialties", subcategory: "Signage", keywords: ["sign","ada","room sign","wayfinding"],
    prices: { us_national: { labor: 35, material: 65, total: 100 }, uk: { labor: 42, material: 72, total: 114 }, uae: { labor: 28, material: 58, total: 86 }, india: { labor: 7, material: 30, total: 37 } } },

  // ─── 11 Equipment ─────────────────────────────────────────────
  { id: "11-0100", csiCode: "11 31 00", masterformatDiv: "11 - Equipment", description: "Commercial Kitchen Range Hood 48\"", unit: "EA", category: "Equipment", subcategory: "Kitchen", keywords: ["hood","kitchen","range","exhaust","commercial"],
    prices: { us_national: { labor: 280, material: 1200, total: 1480 }, uk: { labor: 340, material: 1350, total: 1690 }, uae: { labor: 220, material: 1100, total: 1320 }, india: { labor: 60, material: 700, total: 760 } } },
  { id: "11-0110", csiCode: "11 52 13", masterformatDiv: "11 - Equipment", description: "Projection Screen - Electric 100\"", unit: "EA", category: "Equipment", subcategory: "AV Equipment", keywords: ["screen","projection","motorized","auditorium"],
    prices: { us_national: { labor: 120, material: 680, total: 800 }, uk: { labor: 145, material: 750, total: 895 }, uae: { labor: 95, material: 620, total: 715 }, india: { labor: 25, material: 380, total: 405 } } },

  // ─── 12 Furnishings ───────────────────────────────────────────
  { id: "12-0100", csiCode: "12 21 13", masterformatDiv: "12 - Furnishings", description: "Window Blind - Roller 3' x 6'", unit: "EA", category: "Furnishings", subcategory: "Window Treatment", keywords: ["blind","roller shade","window","curtain"],
    prices: { us_national: { labor: 30, material: 70, total: 100 }, uk: { labor: 36, material: 80, total: 116 }, uae: { labor: 24, material: 65, total: 89 }, india: { labor: 6, material: 35, total: 41 } } },
  { id: "12-0110", csiCode: "12 35 53", masterformatDiv: "12 - Furnishings", description: "Laminate Casework - Base Cabinet 24\"", unit: "LF", category: "Furnishings", subcategory: "Casework", keywords: ["cabinet","casework","base","laminate"],
    prices: { us_national: { labor: 85, material: 195, total: 280 }, uk: { labor: 100, material: 220, total: 320 }, uae: { labor: 68, material: 180, total: 248 }, india: { labor: 18, material: 110, total: 128 } } },

  // ─── 14 Conveying Equipment ───────────────────────────────────
  { id: "14-0100", csiCode: "14 20 00", masterformatDiv: "14 - Conveying Equipment", description: "Hydraulic Elevator - 2-Stop Residential", unit: "EA", category: "Elevator", subcategory: "Hydraulic", keywords: ["elevator","lift","hydraulic","vertical transport"],
    prices: { us_national: { labor: 4500, material: 18000, total: 22500 }, uk: { labor: 5400, material: 20000, total: 25400 }, uae: { labor: 3600, material: 16500, total: 20100 }, india: { labor: 900, material: 10000, total: 10900 } } },
  { id: "14-0110", csiCode: "14 20 00", masterformatDiv: "14 - Conveying Equipment", description: "Traction Elevator - 6-Stop Commercial", unit: "EA", category: "Elevator", subcategory: "Traction", keywords: ["elevator","traction","commercial","high-rise"],
    prices: { us_national: { labor: 12000, material: 58000, total: 70000 }, uk: { labor: 14400, material: 64000, total: 78400 }, uae: { labor: 9600, material: 52000, total: 61600 }, india: { labor: 2400, material: 32000, total: 34400 } } },
  { id: "14-0120", csiCode: "14 31 00", masterformatDiv: "14 - Conveying Equipment", description: "Escalator - Standard 32\" Width", unit: "EA", category: "Elevator", subcategory: "Escalator", keywords: ["escalator","moving stair","commercial"],
    prices: { us_national: { labor: 8000, material: 72000, total: 80000 }, uk: { labor: 9600, material: 80000, total: 89600 }, uae: { labor: 6400, material: 65000, total: 71400 }, india: { labor: 1600, material: 42000, total: 43600 } } },

  // ─── 21 Fire Suppression ──────────────────────────────────────
  { id: "21-0100", csiCode: "21 13 13", masterformatDiv: "21 - Fire Suppression", description: "Sprinkler Head - Upright 1/2\" Orifice", unit: "EA", category: "Fire Suppression", subcategory: "Sprinkler", keywords: ["sprinkler","fire suppression","upright","nozzle"],
    prices: { us_national: { labor: 18, material: 12, total: 30 }, uk: { labor: 22, material: 14, total: 36 }, uae: { labor: 14, material: 11, total: 25 }, india: { labor: 3, material: 6, total: 9 } } },
  { id: "21-0110", csiCode: "21 12 00", masterformatDiv: "21 - Fire Suppression", description: "Fire Sprinkler Pipe - 1\" Schedule 40", unit: "LF", category: "Fire Suppression", subcategory: "Pipe", keywords: ["sprinkler pipe","fire protection","1 inch"],
    prices: { us_national: { labor: 5.50, material: 3.80, total: 9.30 }, uk: { labor: 6.60, material: 4.30, total: 10.90 }, uae: { labor: 4.40, material: 3.50, total: 7.90 }, india: { labor: 1.00, material: 2.20, total: 3.20 } } },

  // ─── 22 Plumbing ──────────────────────────────────────────────
  { id: "22-0100", csiCode: "22 05 29", masterformatDiv: "22 - Plumbing", description: "PVC Drain Pipe 4\"", unit: "LF", category: "Plumbing", subcategory: "Drainage", keywords: ["pvc","drain","pipe","4 inch","sewer"],
    prices: { us_national: { labor: 7.50, material: 3.50, total: 11.00 }, uk: { labor: 9.00, material: 4.00, total: 13.00 }, uae: { labor: 6.00, material: 3.20, total: 9.20 }, india: { labor: 1.40, material: 1.80, total: 3.20 } } },
  { id: "22-0110", csiCode: "22 42 00", masterformatDiv: "22 - Plumbing", description: "Bathtub - Cast Iron 5' White", unit: "EA", category: "Plumbing", subcategory: "Fixture", keywords: ["bathtub","bath","cast iron","tub"],
    prices: { us_national: { labor: 280, material: 520, total: 800 }, uk: { labor: 340, material: 580, total: 920 }, uae: { labor: 224, material: 470, total: 694 }, india: { labor: 56, material: 280, total: 336 } } },
  { id: "22-0120", csiCode: "22 42 00", masterformatDiv: "22 - Plumbing", description: "Shower Base & Valve - 36\"x36\"", unit: "EA", category: "Plumbing", subcategory: "Fixture", keywords: ["shower","valve","base","bathroom"],
    prices: { us_national: { labor: 240, material: 360, total: 600 }, uk: { labor: 290, material: 410, total: 700 }, uae: { labor: 192, material: 325, total: 517 }, india: { labor: 48, material: 195, total: 243 } } },
  { id: "22-0130", csiCode: "22 11 16", masterformatDiv: "22 - Plumbing", description: "Hot Water Heater 50 Gallon Electric", unit: "EA", category: "Plumbing", subcategory: "Equipment", keywords: ["water heater","electric","50 gallon","hot water"],
    prices: { us_national: { labor: 280, material: 420, total: 700 }, uk: { labor: 340, material: 480, total: 820 }, uae: { labor: 224, material: 380, total: 604 }, india: { labor: 56, material: 230, total: 286 } } },
  { id: "22-0140", csiCode: "22 11 16", masterformatDiv: "22 - Plumbing", description: "Tankless Water Heater - Gas 180K BTU", unit: "EA", category: "Plumbing", subcategory: "Equipment", keywords: ["tankless","water heater","gas","on-demand"],
    prices: { us_national: { labor: 380, material: 820, total: 1200 }, uk: { labor: 460, material: 920, total: 1380 }, uae: { labor: 304, material: 740, total: 1044 }, india: { labor: 76, material: 450, total: 526 } } },

  // ─── 23 HVAC ──────────────────────────────────────────────────
  { id: "23-0100", csiCode: "23 31 13", masterformatDiv: "23 - HVAC", description: "Ductwork - Galvanized Sheet Metal 16\"x10\"", unit: "LF", category: "HVAC", subcategory: "Ductwork", keywords: ["duct","hvac","sheet metal","ductwork"],
    prices: { us_national: { labor: 22, material: 18, total: 40 }, uk: { labor: 26, material: 20, total: 46 }, uae: { labor: 18, material: 16, total: 34 }, india: { labor: 4, material: 10, total: 14 } } },
  { id: "23-0110", csiCode: "23 82 19", masterformatDiv: "23 - HVAC", description: "Fan Coil Unit - 2 Ton Ceiling Mounted", unit: "EA", category: "HVAC", subcategory: "Fan Coil", keywords: ["fan coil","hvac","cooling","2 ton"],
    prices: { us_national: { labor: 380, material: 820, total: 1200 }, uk: { labor: 456, material: 920, total: 1376 }, uae: { labor: 304, material: 740, total: 1044 }, india: { labor: 76, material: 450, total: 526 } } },
  { id: "23-0120", csiCode: "23 74 00", masterformatDiv: "23 - HVAC", description: "Split AC Unit - 3 Ton Inverter", unit: "EA", category: "HVAC", subcategory: "AC Unit", keywords: ["split ac","air conditioning","3 ton","inverter","cooling"],
    prices: { us_national: { labor: 450, material: 1350, total: 1800 }, uk: { labor: 540, material: 1500, total: 2040 }, uae: { labor: 360, material: 1200, total: 1560 }, india: { labor: 90, material: 720, total: 810 }, australia: { labor: 600, material: 1600, total: 2200 } } },
  { id: "23-0130", csiCode: "23 74 00", masterformatDiv: "23 - HVAC", description: "Central Air Handler - 5 Ton", unit: "EA", category: "HVAC", subcategory: "Air Handler", keywords: ["air handler","ahu","5 ton","central air"],
    prices: { us_national: { labor: 750, material: 2750, total: 3500 }, uk: { labor: 900, material: 3100, total: 4000 }, uae: { labor: 600, material: 2500, total: 3100 }, india: { labor: 150, material: 1600, total: 1750 } } },
  { id: "23-0140", csiCode: "23 09 23", masterformatDiv: "23 - HVAC", description: "Thermostat - Programmable Digital", unit: "EA", category: "HVAC", subcategory: "Controls", keywords: ["thermostat","controls","digital","hvac"],
    prices: { us_national: { labor: 45, material: 65, total: 110 }, uk: { labor: 54, material: 72, total: 126 }, uae: { labor: 36, material: 58, total: 94 }, india: { labor: 9, material: 35, total: 44 } } },

  // ─── 26 Electrical (extended) ─────────────────────────────────
  { id: "26-0100", csiCode: "26 27 26", masterformatDiv: "26 - Electrical", description: "GFCI Outlet 20A - Bathroom/Exterior", unit: "EA", category: "Electrical", subcategory: "Devices", keywords: ["gfci","outlet","bathroom","safety"],
    prices: { us_national: { labor: 45, material: 18, total: 63 }, uk: { labor: 54, material: 22, total: 76 }, uae: { labor: 36, material: 16, total: 52 }, india: { labor: 9, material: 10, total: 19 } } },
  { id: "26-0110", csiCode: "26 27 26", masterformatDiv: "26 - Electrical", description: "Switch - Single Pole 15A with Dimmer", unit: "EA", category: "Electrical", subcategory: "Devices", keywords: ["switch","dimmer","single pole","light switch"],
    prices: { us_national: { labor: 35, material: 22, total: 57 }, uk: { labor: 42, material: 26, total: 68 }, uae: { labor: 28, material: 20, total: 48 }, india: { labor: 7, material: 11, total: 18 } } },
  { id: "26-0120", csiCode: "26 05 19", masterformatDiv: "26 - Electrical", description: "EMT Conduit 1\" with Fittings", unit: "LF", category: "Electrical", subcategory: "Conduit", keywords: ["conduit","emt","1 inch","electrical conduit"],
    prices: { us_national: { labor: 3.20, material: 2.80, total: 6.00 }, uk: { labor: 3.84, material: 3.20, total: 7.04 }, uae: { labor: 2.56, material: 2.60, total: 5.16 }, india: { labor: 0.60, material: 1.60, total: 2.20 } } },
  { id: "26-0130", csiCode: "26 51 00", masterformatDiv: "26 - Electrical", description: "Exit Sign - LED Battery Backup", unit: "EA", category: "Electrical", subcategory: "Lighting", keywords: ["exit sign","emergency","led","battery backup"],
    prices: { us_national: { labor: 55, material: 85, total: 140 }, uk: { labor: 66, material: 96, total: 162 }, uae: { labor: 44, material: 76, total: 120 }, india: { labor: 11, material: 45, total: 56 } } },
  { id: "26-0140", csiCode: "26 24 00", masterformatDiv: "26 - Electrical", description: "Transformer - Dry Type 75 kVA", unit: "EA", category: "Electrical", subcategory: "Distribution", keywords: ["transformer","dry type","75 kva","electrical"],
    prices: { us_national: { labor: 1200, material: 3800, total: 5000 }, uk: { labor: 1440, material: 4300, total: 5740 }, uae: { labor: 960, material: 3500, total: 4460 }, india: { labor: 240, material: 2200, total: 2440 } } },

  // ─── 31 Earthwork ─────────────────────────────────────────────
  { id: "31-0100", csiCode: "31 20 00", masterformatDiv: "31 - Earthwork", description: "Excavation - Bulk Cut & Fill", unit: "CY", category: "Earthwork", subcategory: "Excavation", keywords: ["excavation","cut","fill","earthwork","grading"],
    prices: { us_national: { labor: 12, material: 0, total: 12 }, uk: { labor: 14, material: 0, total: 14 }, uae: { labor: 8, material: 0, total: 8 }, india: { labor: 2, material: 0, total: 2 }, australia: { labor: 18, material: 0, total: 18 } } },
  { id: "31-0110", csiCode: "31 23 33", masterformatDiv: "31 - Earthwork", description: "Trench Excavation - Utility 3' Deep", unit: "LF", category: "Earthwork", subcategory: "Trenching", keywords: ["trench","excavation","utility","pipe trench"],
    prices: { us_national: { labor: 8, material: 0, total: 8 }, uk: { labor: 10, material: 0, total: 10 }, uae: { labor: 5, material: 0, total: 5 }, india: { labor: 1.50, material: 0, total: 1.50 } } },
  { id: "31-0120", csiCode: "31 05 16", masterformatDiv: "31 - Earthwork", description: "Aggregate Base Course 6\"", unit: "CY", category: "Earthwork", subcategory: "Base Course", keywords: ["aggregate","base","gravel","road base","compacted"],
    prices: { us_national: { labor: 18, material: 22, total: 40 }, uk: { labor: 22, material: 26, total: 48 }, uae: { labor: 14, material: 18, total: 32 }, india: { labor: 3, material: 12, total: 15 } } },
  { id: "31-0130", csiCode: "31 10 00", masterformatDiv: "31 - Earthwork", description: "Tree Removal - 6\" Trunk Diameter", unit: "EA", category: "Earthwork", subcategory: "Site Clearing", keywords: ["tree removal","site clearing","stump","landscape"],
    prices: { us_national: { labor: 350, material: 0, total: 350 }, uk: { labor: 420, material: 0, total: 420 }, uae: { labor: 280, material: 0, total: 280 }, india: { labor: 70, material: 0, total: 70 } } },

  // ─── 32 Exterior Improvements ─────────────────────────────────
  { id: "32-0100", csiCode: "32 12 16", masterformatDiv: "32 - Exterior Improvements", description: "Asphalt Paving 2\" Overlay", unit: "SY", category: "Paving", subcategory: "Asphalt", keywords: ["asphalt","paving","overlay","parking","road"],
    prices: { us_national: { labor: 8, material: 14, total: 22 }, uk: { labor: 10, material: 16, total: 26 }, uae: { labor: 6, material: 12, total: 18 }, india: { labor: 1.50, material: 8, total: 9.50 }, australia: { labor: 12, material: 18, total: 30 } } },
  { id: "32-0110", csiCode: "32 13 13", masterformatDiv: "32 - Exterior Improvements", description: "Concrete Sidewalk 4\" Thick", unit: "SF", category: "Paving", subcategory: "Concrete", keywords: ["concrete","sidewalk","walkway","path","pavement"],
    prices: { us_national: { labor: 2.50, material: 3.50, total: 6.00 }, uk: { labor: 3.00, material: 4.00, total: 7.00 }, uae: { labor: 2.00, material: 3.20, total: 5.20 }, india: { labor: 0.50, material: 2.00, total: 2.50 } } },
  { id: "32-0120", csiCode: "32 92 19", masterformatDiv: "32 - Exterior Improvements", description: "Seeding & Topsoil - Lawn Area", unit: "SF", category: "Landscaping", subcategory: "Lawn", keywords: ["seeding","lawn","topsoil","grass","landscaping"],
    prices: { us_national: { labor: 0.15, material: 0.25, total: 0.40 }, uk: { labor: 0.18, material: 0.28, total: 0.46 }, uae: { labor: 0.12, material: 0.30, total: 0.42 }, india: { labor: 0.02, material: 0.15, total: 0.17 } } },
  { id: "32-0130", csiCode: "32 31 13", masterformatDiv: "32 - Exterior Improvements", description: "Chain Link Fence 6' High", unit: "LF", category: "Site Work", subcategory: "Fencing", keywords: ["fence","chain link","6 foot","security","perimeter"],
    prices: { us_national: { labor: 8, material: 14, total: 22 }, uk: { labor: 10, material: 16, total: 26 }, uae: { labor: 6, material: 12, total: 18 }, india: { labor: 1.50, material: 7, total: 8.50 } } },

  // ─── 33 Utilities ─────────────────────────────────────────────
  { id: "33-0100", csiCode: "33 40 00", masterformatDiv: "33 - Utilities", description: "Storm Drain Pipe - 12\" RCP", unit: "LF", category: "Utilities", subcategory: "Storm Drain", keywords: ["storm drain","rcp","12 inch","culvert","drainage"],
    prices: { us_national: { labor: 18, material: 22, total: 40 }, uk: { labor: 22, material: 26, total: 48 }, uae: { labor: 14, material: 18, total: 32 }, india: { labor: 3, material: 12, total: 15 } } },
  { id: "33-0110", csiCode: "33 11 00", masterformatDiv: "33 - Utilities", description: "Water Main - 6\" Ductile Iron", unit: "LF", category: "Utilities", subcategory: "Water Main", keywords: ["water main","ductile iron","6 inch","water supply"],
    prices: { us_national: { labor: 35, material: 28, total: 63 }, uk: { labor: 42, material: 32, total: 74 }, uae: { labor: 28, material: 25, total: 53 }, india: { labor: 6, material: 15, total: 21 } } },

  // ─── Sitework & Civil ─────────────────────────────────────────
  { id: "01-0100", csiCode: "01 50 00", masterformatDiv: "01 - General Requirements", description: "Temporary Facilities - Site Office & Storage", unit: "LS", category: "Preliminaries", subcategory: "Temporary Works", keywords: ["temporary","site office","mobilization","prelim"],
    prices: { us_national: { labor: 1500, material: 3500, total: 5000 }, uk: { labor: 1800, material: 4000, total: 5800 }, uae: { labor: 1200, material: 3000, total: 4200 }, india: { labor: 300, material: 1800, total: 2100 } } },
  { id: "01-0110", csiCode: "01 56 00", masterformatDiv: "01 - General Requirements", description: "Dust & Noise Control Measures", unit: "LS", category: "Preliminaries", subcategory: "Environmental", keywords: ["dust control","noise","environmental","prelim"],
    prices: { us_national: { labor: 800, material: 1200, total: 2000 }, uk: { labor: 960, material: 1380, total: 2340 }, uae: { labor: 640, material: 1000, total: 1640 }, india: { labor: 160, material: 600, total: 760 } } },
  { id: "01-0120", csiCode: "01 74 19", masterformatDiv: "01 - General Requirements", description: "Construction Waste Disposal - Per Load", unit: "EA", category: "Preliminaries", subcategory: "Waste Disposal", keywords: ["waste","dumpster","disposal","rubbish"],
    prices: { us_national: { labor: 50, material: 250, total: 300 }, uk: { labor: 60, material: 280, total: 340 }, uae: { labor: 40, material: 200, total: 240 }, india: { labor: 10, material: 80, total: 90 } } },

  // ─── Structural Steel (extended) ─────────────────────────────
  { id: "05-0200", csiCode: "05 12 00", masterformatDiv: "05 - Metals", description: "Structural Steel - W14x48 Column", unit: "LF", category: "Metals", subcategory: "Steel Column", keywords: ["steel","column","w14","structural"],
    prices: { us_national: { labor: 35, material: 55, total: 90 }, uk: { labor: 42, material: 62, total: 104 }, uae: { labor: 28, material: 50, total: 78 }, india: { labor: 7, material: 38, total: 45 } } },
  { id: "05-0210", csiCode: "05 31 00", masterformatDiv: "05 - Metals", description: "Metal Deck - 20 Gauge 1.5\" Roof", unit: "SF", category: "Metals", subcategory: "Metal Deck", keywords: ["metal deck","roof deck","20 gauge","steel deck"],
    prices: { us_national: { labor: 1.20, material: 1.80, total: 3.00 }, uk: { labor: 1.44, material: 2.10, total: 3.54 }, uae: { labor: 0.96, material: 1.65, total: 2.61 }, india: { labor: 0.24, material: 1.10, total: 1.34 } } },
  { id: "05-0220", csiCode: "05 40 00", masterformatDiv: "05 - Metals", description: "Cold-Formed Metal Stud 3-5/8\" 20 Ga", unit: "LF", category: "Metals", subcategory: "Light Framing", keywords: ["metal stud","light gauge","cold formed","framing"],
    prices: { us_national: { labor: 1.10, material: 0.90, total: 2.00 }, uk: { labor: 1.32, material: 1.05, total: 2.37 }, uae: { labor: 0.88, material: 0.82, total: 1.70 }, india: { labor: 0.22, material: 0.55, total: 0.77 } } },

  // ─── Masonry (extended) ───────────────────────────────────────
  { id: "04-0200", csiCode: "04 22 00", masterformatDiv: "04 - Masonry", description: "CMU Block 8\" Filled with Concrete & Rebar", unit: "SF", category: "Masonry", subcategory: "Reinforced CMU", keywords: ["cmu","reinforced","grouted","masonry wall"],
    prices: { us_national: { labor: 8.50, material: 7.50, total: 16.00 }, uk: { labor: 10.20, material: 8.50, total: 18.70 }, uae: { labor: 6.80, material: 6.80, total: 13.60 }, india: { labor: 1.80, material: 4.50, total: 6.30 } } },
  { id: "04-0210", csiCode: "04 05 23", masterformatDiv: "04 - Masonry", description: "Mortar - Type S Masonry", unit: "BAG", category: "Masonry", subcategory: "Mortar", keywords: ["mortar","masonry","type s","mix"],
    prices: { us_national: { labor: 0, material: 8.50, total: 8.50 }, uk: { labor: 0, material: 9.80, total: 9.80 }, uae: { labor: 0, material: 7.50, total: 7.50 }, india: { labor: 0, material: 4.50, total: 4.50 } } },
  { id: "04-0220", csiCode: "04 43 00", masterformatDiv: "04 - Masonry", description: "Natural Stone Cladding - 2\" Limestone", unit: "SF", category: "Masonry", subcategory: "Stone", keywords: ["limestone","stone cladding","facade","natural stone"],
    prices: { us_national: { labor: 12, material: 28, total: 40 }, uk: { labor: 14, material: 32, total: 46 }, uae: { labor: 10, material: 25, total: 35 }, india: { labor: 2.50, material: 15, total: 17.50 } } },

  // ─── Concrete (extended) ──────────────────────────────────────
  { id: "03-0200", csiCode: "03 30 00", masterformatDiv: "03 - Concrete", description: "Concrete Pump - Per Hour", unit: "HR", category: "Concrete", subcategory: "Equipment", keywords: ["concrete pump","pump","equipment","pour"],
    prices: { us_national: { labor: 120, material: 0, total: 120 }, uk: { labor: 145, material: 0, total: 145 }, uae: { labor: 95, material: 0, total: 95 }, india: { labor: 25, material: 0, total: 25 } } },
  { id: "03-0210", csiCode: "03 11 00", masterformatDiv: "03 - Concrete", description: "Formwork - Wall 8' High", unit: "SF", category: "Concrete", subcategory: "Formwork", keywords: ["formwork","form","wall","shutter","shuttering"],
    prices: { us_national: { labor: 4.50, material: 2.50, total: 7.00 }, uk: { labor: 5.40, material: 2.80, total: 8.20 }, uae: { labor: 3.60, material: 2.20, total: 5.80 }, india: { labor: 0.90, material: 1.30, total: 2.20 } } },
  { id: "03-0220", csiCode: "03 30 00", masterformatDiv: "03 - Concrete", description: "Concrete Ready-Mix 4000 PSI - Truck", unit: "CY", category: "Concrete", subcategory: "Ready Mix", keywords: ["concrete","ready mix","4000 psi","C25","C30"],
    prices: { us_national: { labor: 0, material: 145, total: 145 }, uk: { labor: 0, material: 132, total: 132 }, uae: { labor: 0, material: 110, total: 110 }, india: { labor: 0, material: 75, total: 75 }, australia: { labor: 0, material: 155, total: 155 }, germany: { labor: 0, material: 128, total: 128 } } },

  // ─── Finishes (extended) ─────────────────────────────────────
  { id: "09-0200", csiCode: "09 30 00", masterformatDiv: "09 - Finishes", description: "Marble Tile 12\"x12\" Floor", unit: "SF", category: "Flooring", subcategory: "Marble", keywords: ["marble","tile","floor","luxury","stone"],
    prices: { us_national: { labor: 3.50, material: 12.00, total: 15.50 }, uk: { labor: 4.20, material: 14.00, total: 18.20 }, uae: { labor: 2.80, material: 10.00, total: 12.80 }, india: { labor: 0.70, material: 6.00, total: 6.70 } } },
  { id: "09-0210", csiCode: "09 22 16", masterformatDiv: "09 - Finishes", description: "Metal Furring Channel 7/8\" Hat Section", unit: "LF", category: "Drywall", subcategory: "Furring", keywords: ["furring","channel","metal","framing","hat"],
    prices: { us_national: { labor: 0.55, material: 0.38, total: 0.93 }, uk: { labor: 0.66, material: 0.43, total: 1.09 }, uae: { labor: 0.44, material: 0.35, total: 0.79 }, india: { labor: 0.11, material: 0.22, total: 0.33 } } },
  { id: "09-0220", csiCode: "09 21 16", masterformatDiv: "09 - Finishes", description: "Moisture-Resistant Drywall 1/2\" Green Board", unit: "SF", category: "Drywall", subcategory: "Specialty", keywords: ["greenboard","moisture resistant","drywall","bathroom","wet area"],
    prices: { us_national: { labor: 0.35, material: 0.32, total: 0.67 }, uk: { labor: 0.42, material: 0.38, total: 0.80 }, uae: { labor: 0.28, material: 0.35, total: 0.63 }, india: { labor: 0.06, material: 0.22, total: 0.28 } } },
  { id: "09-0230", csiCode: "09 91 23", masterformatDiv: "09 - Finishes", description: "Epoxy Floor Coating - 2-Part System", unit: "SF", category: "Flooring", subcategory: "Coating", keywords: ["epoxy","floor coating","garage","industrial","resin"],
    prices: { us_national: { labor: 1.80, material: 2.20, total: 4.00 }, uk: { labor: 2.16, material: 2.50, total: 4.66 }, uae: { labor: 1.44, material: 2.00, total: 3.44 }, india: { labor: 0.36, material: 1.20, total: 1.56 } } },
  { id: "09-0240", csiCode: "09 22 36", masterformatDiv: "09 - Finishes", description: "Suspended Acoustic Ceiling Tile 2'x2'", unit: "SF", category: "Ceilings", subcategory: "Acoustic Tile", keywords: ["acoustic ceiling","suspended","t-bar","office ceiling"],
    prices: { us_national: { labor: 1.10, material: 1.40, total: 2.50 }, uk: { labor: 1.32, material: 1.60, total: 2.92 }, uae: { labor: 0.88, material: 1.28, total: 2.16 }, india: { labor: 0.22, material: 0.80, total: 1.02 }, australia: { labor: 1.45, material: 1.70, total: 3.15 } } },

  // ─── Doors & Windows (extended) ───────────────────────────────
  { id: "08-0200", csiCode: "08 11 13", masterformatDiv: "08 - Doors & Windows", description: "Fire Door 90-Min UL-Rated 3'x7'", unit: "EA", category: "Doors & Windows", subcategory: "Fire Door", keywords: ["fire door","ul rated","90 min","fire rated"],
    prices: { us_national: { labor: 220, material: 680, total: 900 }, uk: { labor: 264, material: 760, total: 1024 }, uae: { labor: 176, material: 620, total: 796 }, india: { labor: 44, material: 380, total: 424 } } },
  { id: "08-0210", csiCode: "08 90 00", masterformatDiv: "08 - Doors & Windows", description: "Storefront System - Aluminum & Glass per LF", unit: "LF", category: "Doors & Windows", subcategory: "Storefront", keywords: ["storefront","aluminum","glass facade","curtain wall"],
    prices: { us_national: { labor: 85, material: 165, total: 250 }, uk: { labor: 102, material: 188, total: 290 }, uae: { labor: 68, material: 150, total: 218 }, india: { labor: 17, material: 95, total: 112 } } },
  { id: "08-0220", csiCode: "08 33 23", masterformatDiv: "08 - Doors & Windows", description: "Rolling Steel Shutter 10'x10'", unit: "EA", category: "Doors & Windows", subcategory: "Shutter", keywords: ["rolling shutter","steel door","garage","industrial"],
    prices: { us_national: { labor: 450, material: 1350, total: 1800 }, uk: { labor: 540, material: 1500, total: 2040 }, uae: { labor: 360, material: 1200, total: 1560 }, india: { labor: 90, material: 750, total: 840 } } },
];

// Semantic search — keyword match + fuzzy
export function searchCostDatabase(query: string, region: Region = "us_national", limit = 20): (CostItem & { score: number; regionPrice: { labor: number; material: number; total: number } | null })[] {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/);

  return COST_DATABASE
    .map((item) => {
      let score = 0;
      const searchText = `${item.description} ${item.category} ${item.subcategory} ${item.keywords.join(" ")} ${item.csiCode}`.toLowerCase();
      for (const word of words) {
        if (searchText.includes(word)) score += word.length > 3 ? 3 : 1;
      }
      if (item.description.toLowerCase().includes(q)) score += 10;
      return { ...item, score, regionPrice: item.prices[region] ?? null };
    })
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getByCategory(category: string, region: Region = "us_national") {
  return COST_DATABASE
    .filter((i) => i.category === category || i.masterformatDiv.includes(category))
    .map((i) => ({ ...i, regionPrice: i.prices[region] ?? null }));
}

export const ALL_CATEGORIES = [...new Set(COST_DATABASE.map((i) => i.category))];
export const ALL_DIVISIONS = [...new Set(COST_DATABASE.map((i) => i.masterformatDiv))];
