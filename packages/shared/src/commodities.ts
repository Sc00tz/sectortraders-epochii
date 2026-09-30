export const COMMODITIES = ["ore", "org", "equ"] as const;
export type Commodity = (typeof COMMODITIES)[number];

export const COMMODITY_LABEL: Record<Commodity, string> = {
  ore: "Fuel Ore",
  org: "Organics",
  equ: "Equipment",
};
