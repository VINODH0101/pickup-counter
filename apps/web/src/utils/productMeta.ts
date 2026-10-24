export interface ProductMeta {
  category: "Savory & Crisps" | "Chocolates & Sweets" | "Cold Beverages" | "Healthy & Energy";
  description: string;
  tag: string;
  emoji: string;
  glowColor: "amber" | "cyan" | "emerald" | "purple" | "rose" | "orange";
}

export const PRODUCT_CATEGORIES = [
  "All Items",
  "Savory & Crisps",
  "Chocolates & Sweets",
  "Cold Beverages",
  "Healthy & Energy",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

const META_MAP: Record<string, ProductMeta> = {
  "Chips": {
    category: "Savory & Crisps",
    description: "Hand-selected golden potatoes slow-cooked and finished with crystalline sea salt.",
    tag: "Classic Salted",
    emoji: "🥔",
    glowColor: "amber",
  },
  "Cookies": {
    category: "Chocolates & Sweets",
    description: "Traditional artisan butter cookies loaded with rich Belgian chocolate chunks.",
    tag: "Artisan Baked",
    emoji: "🍪",
    glowColor: "orange",
  },
  "Chocolate bar": {
    category: "Chocolates & Sweets",
    description: "Velvety milk chocolate bar made from sustainably harvested single-origin cocoa beans.",
    tag: "Silk Blend",
    emoji: "🍫",
    glowColor: "amber",
  },
  "Juice": {
    category: "Cold Beverages",
    description: "100% cold-pressed Valencia oranges and sun-ripened Alphonso mangoes, zero added sugar.",
    tag: "Cold Pressed",
    emoji: "🧃",
    glowColor: "orange",
  },
  "Water bottle": {
    category: "Cold Beverages",
    description: "Pure, naturally filtered mineral water sourced straight from high-altitude Himalayan springs.",
    tag: "Spring Mineral",
    emoji: "💧",
    glowColor: "cyan",
  },
  "Roasted Almonds & Cashews": {
    category: "Healthy & Energy",
    description: "Slow-roasted California almonds and whole Malabar cashews seasoned with sea salt.",
    tag: "High Protein",
    emoji: "🥜",
    glowColor: "emerald",
  },
  "Artisanal Dark Chocolate 72%": {
    category: "Chocolates & Sweets",
    description: "Deep, complex 72% dark roast with hints of toasted hazelnut and wild berries.",
    tag: "72% Cocoa",
    emoji: "🍫",
    glowColor: "purple",
  },
  "Sparkling Berry Kombucha": {
    category: "Cold Beverages",
    description: "Naturally effervescent organic green tea fermented with wild blueberries and raspberries.",
    tag: "Probiotic Fizz",
    emoji: "🍇",
    glowColor: "rose",
  },
  "Truffle Potato Crisps": {
    category: "Savory & Crisps",
    description: "Gourmet kettle-cooked potato crisps infused with aromatic Italian black summer truffles.",
    tag: "Black Truffle",
    emoji: "🥔",
    glowColor: "amber",
  },
  "Cold Brew Nitro Coffee": {
    category: "Cold Beverages",
    description: "18-hour cold steeped single-estate Arabica infused with velvety nitrogen microbubbles.",
    tag: "Nitro Infused",
    emoji: "☕",
    glowColor: "cyan",
  },
  "Roasted Peri-Peri Makhana": {
    category: "Healthy & Energy",
    description: "Crisp popped lotus water lily seeds tossed with smoky, fiery African peri-peri spices.",
    tag: "Superfood",
    emoji: "🍿",
    glowColor: "rose",
  },
  "Organic Granola Honey Bar": {
    category: "Healthy & Energy",
    description: "Wholesome rolled oats bound with wildflower forest honey, chia seeds, and dried cranberries.",
    tag: "All Natural",
    emoji: "🌾",
    glowColor: "emerald",
  },
};

export function getProductMeta(name: string): ProductMeta {
  if (META_MAP[name]) {
    return META_MAP[name];
  }

  // Fallback heuristic based on name keywords
  const lower = name.toLowerCase();
  if (lower.includes("water") || lower.includes("drink") || lower.includes("coffee") || lower.includes("tea") || lower.includes("juice") || lower.includes("kombucha")) {
    return {
      category: "Cold Beverages",
      description: "Refreshing premium chilled beverage from our locker cooler compartment.",
      tag: "Chilled",
      emoji: "🥤",
      glowColor: "cyan",
    };
  }
  if (lower.includes("choc") || lower.includes("cookie") || lower.includes("sweet") || lower.includes("cake") || lower.includes("biscuit")) {
    return {
      category: "Chocolates & Sweets",
      description: "Delectable confection made with premium ingredients and rich cocoa.",
      tag: "Confection",
      emoji: "🍫",
      glowColor: "amber",
    };
  }
  if (lower.includes("nut") || lower.includes("almond") || lower.includes("cashew") || lower.includes("seed") || lower.includes("granola") || lower.includes("makhana")) {
    return {
      category: "Healthy & Energy",
      description: "Wholesome, nutrient-dense snack packed with protein and wholesome energy.",
      tag: "Nutritious",
      emoji: "🥜",
      glowColor: "emerald",
    };
  }
  return {
    category: "Savory & Crisps",
    description: "Crispy, savory snack prepared with quality spices and crunch.",
    tag: "Gourmet Snack",
    emoji: "🍿",
    glowColor: "amber",
  };
}
