// Tailwind for webpack builds (`next dev --webpack`) and tools like Vitest;
// Turbopack uses the loader in next.config.ts.
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
