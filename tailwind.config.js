/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: '#7DA87B',
        bgBase: '#F9F8F3',
        darkCharcoal: '#2D2D2D',
      }
    },
  },
  plugins: [],
}