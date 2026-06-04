// Material consumption rates per 100 sq ft (from Repo 2: Zinalr44)
// Used for area-to-quantity conversion without user input

export interface MaterialRate {
  name: string;
  unit: string;
  ratesPer100SqFt: number;
  category: string;
  avgUnitCost: number; // USD
}

export const MATERIAL_RATES: Record<string, MaterialRate> = {
  // Concrete
  concrete_slab:    { name: "Concrete (Slab 4\")",         unit: "CY",  ratesPer100SqFt: 1.23,  category: "Concrete",   avgUnitCost: 165 },
  concrete_footing: { name: "Concrete (Footing)",           unit: "CY",  ratesPer100SqFt: 0.74,  category: "Concrete",   avgUnitCost: 180 },

  // Lumber / Framing
  studs_16oc:       { name: "2×4 Studs @ 16\" OC",          unit: "EA",  ratesPer100SqFt: 7.5,   category: "Lumber",     avgUnitCost: 4.50 },
  studs_24oc:       { name: "2×4 Studs @ 24\" OC",          unit: "EA",  ratesPer100SqFt: 5.0,   category: "Lumber",     avgUnitCost: 4.50 },
  top_plates:       { name: "2×4 Top Plates (double)",       unit: "LF",  ratesPer100SqFt: 2.0,   category: "Lumber",     avgUnitCost: 0.65 },
  bottom_plates:    { name: "2×4 Bottom Plates",             unit: "LF",  ratesPer100SqFt: 1.0,   category: "Lumber",     avgUnitCost: 0.65 },
  floor_joists:     { name: "2×10 Floor Joists @ 16\" OC",  unit: "LF",  ratesPer100SqFt: 7.5,   category: "Lumber",     avgUnitCost: 1.20 },
  rafters:          { name: "2×6 Rafters",                   unit: "LF",  ratesPer100SqFt: 8.0,   category: "Lumber",     avgUnitCost: 0.90 },

  // Drywall
  drywall_walls:    { name: "Drywall 1/2\" (Walls)",         unit: "SF",  ratesPer100SqFt: 110,   category: "Drywall",    avgUnitCost: 0.55 },
  drywall_ceiling:  { name: "Drywall 5/8\" (Ceiling)",       unit: "SF",  ratesPer100SqFt: 100,   category: "Drywall",    avgUnitCost: 0.65 },

  // Insulation
  batt_r13:         { name: "Batt Insulation R-13",          unit: "SF",  ratesPer100SqFt: 105,   category: "Insulation", avgUnitCost: 0.38 },
  batt_r21:         { name: "Batt Insulation R-21",          unit: "SF",  ratesPer100SqFt: 105,   category: "Insulation", avgUnitCost: 0.55 },
  rigid_r10:        { name: "Rigid Foam R-10",               unit: "SF",  ratesPer100SqFt: 100,   category: "Insulation", avgUnitCost: 0.85 },

  // Roofing
  shingles:         { name: "Asphalt Shingles (30yr)",       unit: "SQ",  ratesPer100SqFt: 1.15,  category: "Roofing",    avgUnitCost: 95 },
  underlayment:     { name: "Roofing Underlayment",          unit: "SF",  ratesPer100SqFt: 115,   category: "Roofing",    avgUnitCost: 0.18 },
  sheathing:        { name: "OSB Sheathing 7/16\"",          unit: "SF",  ratesPer100SqFt: 105,   category: "Roofing",    avgUnitCost: 0.68 },

  // Flooring
  hardwood:         { name: "Hardwood Flooring",             unit: "SF",  ratesPer100SqFt: 108,   category: "Flooring",   avgUnitCost: 5.50 },
  tile_12x12:       { name: "Ceramic Tile 12×12",            unit: "SF",  ratesPer100SqFt: 110,   category: "Flooring",   avgUnitCost: 3.25 },
  lvp:              { name: "LVP Flooring",                   unit: "SF",  ratesPer100SqFt: 108,   category: "Flooring",   avgUnitCost: 2.80 },
  carpet:           { name: "Carpet (with pad)",             unit: "SY",  ratesPer100SqFt: 12.0,  category: "Flooring",   avgUnitCost: 28 },

  // Masonry
  cmu_8:            { name: "CMU Block 8\"",                 unit: "EA",  ratesPer100SqFt: 112,   category: "Masonry",    avgUnitCost: 2.85 },
  brick:            { name: "Common Brick",                  unit: "EA",  ratesPer100SqFt: 675,   category: "Masonry",    avgUnitCost: 0.85 },

  // Paint
  paint_interior:   { name: "Interior Paint (2 coats)",     unit: "GAL", ratesPer100SqFt: 0.55,  category: "Finishes",   avgUnitCost: 38 },
  paint_exterior:   { name: "Exterior Paint (2 coats)",     unit: "GAL", ratesPer100SqFt: 0.40,  category: "Finishes",   avgUnitCost: 45 },
};

// Structural codes (from Repo 2)
export const STRUCTURAL_CODES: Record<string, { name: string; category: string }> = {
  MST48: { name: "Metal Strap Tie MST48", category: "Hardware" },
  LVL:   { name: "Laminated Veneer Lumber Beam", category: "Lumber" },
  HDU2:  { name: "Holdown Device HDU2", category: "Hardware" },
  HSS:   { name: "Hollow Structural Section", category: "Steel" },
  LSL:   { name: "Laminated Strand Lumber", category: "Lumber" },
};

export function estimateFromArea(areaSqFt: number, materialKey: string): { quantity: number; unit: string; totalCost: number } | null {
  const rate = MATERIAL_RATES[materialKey];
  if (!rate) return null;
  const quantity = +(areaSqFt * rate.ratesPer100SqFt / 100).toFixed(2);
  const totalCost = +(quantity * rate.avgUnitCost).toFixed(2);
  return { quantity, unit: rate.unit, totalCost };
}
