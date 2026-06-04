export const TAKEOFF_EXTRACTION_PROMPT = `You are a professional construction estimator. Analyze this architectural drawing or document and extract all material quantities for a construction takeoff.

Return a JSON array of takeoff items with this exact structure:
\`\`\`json
[
  {
    "category": "Lumber",
    "subcategory": "Wall Framing",
    "description": "2x4 Studs @ 16\" O.C.",
    "quantity": 45,
    "unit": "EA",
    "unitCost": 4.50,
    "notes": "Exterior walls, 9ft height"
  }
]
\`\`\`

Categories to look for:
- Lumber (studs, plates, headers, joists, rafters, beams)
- Concrete (slabs, footings, walls, columns)
- Masonry (CMU blocks, brick, stone)
- Drywall (interior partitions, ceilings)
- Insulation (batt, rigid, spray foam)
- Roofing (shingles, underlayment, decking)
- Flooring (tile, hardwood, carpet, LVP)
- Doors & Windows (include sizes)
- Plumbing (fixtures, rough-in)
- Electrical (panels, outlets, lights)
- HVAC (units, ductwork)
- Finishes (paint, trim, cabinets)

Units to use: EA (each), LF (linear feet), SF (square feet), CY (cubic yards), SY (square yards), BF (board feet), TON, GAL

Be precise with quantities. If a dimension is shown, calculate the quantity. If not visible, mark confidence as low.`;

export const BOQ_GENERATION_PROMPT = `Convert this material takeoff list into a formal Bill of Quantities (BOQ) following CSI MasterFormat divisions. Group items by trade section and provide unit costs.`;
