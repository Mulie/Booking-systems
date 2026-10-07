import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#1f2937", accent: "#b45309", soft: "#f5f1ea" } },
    },
  },
  plugins: [],
} satisfies Config;
