export interface ProductMeta {
  category: "Savory & Crisps" | "Chocolates & Sweets" | "Cold Beverages" | "Healthy & Energy";
  description: string;
  tag: string;
  emoji: string;
  glowColor: "amber" | "cyan" | "emerald" | "purple" | "rose" | "orange";
  imageUrl: string;
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
    imageUrl: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=600&q=80",
  },
  "Cookies": {
    category: "Chocolates & Sweets",
    description: "Traditional artisan butter cookies loaded with rich Belgian chocolate chunks.",
    tag: "Artisan Baked",
    emoji: "🍪",
    glowColor: "orange",
    imageUrl: "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=600&q=80",
  },
  "Chocolate bar": {
    category: "Chocolates & Sweets",
    description: "Velvety milk chocolate bar made from sustainably harvested single-origin cocoa beans.",
    tag: "Silk Blend",
    emoji: "🍫",
    glowColor: "amber",
    imageUrl: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80",
  },
  "Juice": {
    category: "Cold Beverages",
    description: "100% cold-pressed Valencia oranges and sun-ripened Alphonso mangoes, zero added sugar.",
    tag: "Cold Pressed",
    emoji: "🧃",
    glowColor: "orange",
    imageUrl: "https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=600&q=80",
  },
  "Water bottle": {
    category: "Cold Beverages",
    description: "Pure, naturally filtered mineral water sourced straight from high-altitude Himalayan springs.",
    tag: "Spring Mineral",
    emoji: "💧",
    glowColor: "cyan",
    imageUrl: "https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=600&q=80",
  },
  "Roasted Almonds & Cashews": {
    category: "Healthy & Energy",
    description: "Slow-roasted California almonds and whole Malabar cashews seasoned with sea salt.",
    tag: "High Protein",
    emoji: "🥜",
    glowColor: "emerald",
    imageUrl: "https://images.unsplash.com/photo-1508061253366-f7da158b6d46?auto=format&fit=crop&w=600&q=80",
  },
  "Artisanal Dark Chocolate 72%": {
    category: "Chocolates & Sweets",
    description: "Deep, complex 72% dark roast with hints of toasted hazelnut and wild berries.",
    tag: "72% Cocoa",
    emoji: "🍫",
    glowColor: "purple",
    imageUrl: "https://images.unsplash.com/photo-1548907040-4baa42d10919?auto=format&fit=crop&w=600&q=80",
  },
  "Sparkling Berry Kombucha": {
    category: "Cold Beverages",
    description: "Naturally effervescent organic green tea fermented with wild blueberries and raspberries.",
    tag: "Probiotic Fizz",
    emoji: "🍇",
    glowColor: "rose",
    imageUrl: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80",
  },
  "Truffle Potato Crisps": {
    category: "Savory & Crisps",
    description: "Gourmet kettle-cooked potato crisps infused with aromatic Italian black summer truffles.",
    tag: "Black Truffle",
    emoji: "🥔",
    glowColor: "amber",
    imageUrl: "https://images.unsplash.com/photo-1527842891421-42eec6e703ea?auto=format&fit=crop&w=600&q=80",
  },
  "Cold Brew Nitro Coffee": {
    category: "Cold Beverages",
    description: "18-hour cold steeped single-estate Arabica infused with velvety nitrogen microbubbles.",
    tag: "Nitro Infused",
    emoji: "☕",
    glowColor: "cyan",
    imageUrl: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=600&q=80",
  },
  "Roasted Peri-Peri Makhana": {
    category: "Healthy & Energy",
    description: "Crisp popped lotus water lily seeds tossed with smoky, fiery African peri-peri spices.",
    tag: "Superfood",
    emoji: "🍿",
    glowColor: "rose",
    imageUrl: "https://images.unsplash.com/photo-1578849278619-e73505e9610f?auto=format&fit=crop&w=600&q=80",
  },
  "Organic Granola Honey Bar": {
    category: "Healthy & Energy",
    description: "Wholesome rolled oats bound with wildflower forest honey, chia seeds, and dried cranberries.",
    tag: "All Natural",
    emoji: "🌾",
    glowColor: "emerald",
    imageUrl: "https://images.unsplash.com/photo-1622484212850-cab596d63428?auto=format&fit=crop&w=600&q=80",
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
      imageUrl: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80",
    };
  }
  if (lower.includes("choc") || lower.includes("cookie") || lower.includes("sweet") || lower.includes("cake") || lower.includes("biscuit")) {
    return {
      category: "Chocolates & Sweets",
      description: "Delectable confection made with premium ingredients and rich cocoa.",
      tag: "Confection",
      emoji: "🍫",
      glowColor: "amber",
      imageUrl: "https://images.unsplash.com/photo-1548907040-4baa42d10919?auto=format&fit=crop&w=600&q=80",
    };
  }
  if (lower.includes("nut") || lower.includes("almond") || lower.includes("cashew") || lower.includes("seed") || lower.includes("granola") || lower.includes("makhana")) {
    return {
      category: "Healthy & Energy",
      description: "Wholesome, nutrient-dense snack packed with protein and wholesome energy.",
      tag: "Nutritious",
      emoji: "🥜",
      glowColor: "emerald",
      imageUrl: "https://images.unsplash.com/photo-1508061253366-f7da158b6d46?auto=format&fit=crop&w=600&q=80",
    };
  }
  return {
    category: "Savory & Crisps",
    description: "Crispy, savory snack prepared with quality spices and crunch.",
    tag: "Gourmet Snack",
    emoji: "🍿",
    glowColor: "amber",
    imageUrl: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=600&q=80",
  };
}
