/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'game-bg': '#0f1015',
        'game-card': '#1a1b23',
        'game-border': '#2d2f3a',
        'game-blue': '#3b82f6',
        'game-purple': '#8b5cf6',
        'game-green': '#10b981',
        'game-yellow': '#f59e0b',
        'game-red': '#ef4444',
        'game-text': '#e5e7eb',
        'game-text-dim': '#9ca3af',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-green': 'pulse-green 2s infinite',
        'pulse-yellow': 'pulse-yellow 1.5s infinite',
        'pulse-red': 'pulse-red 1s infinite',
      },
    },
  },
  plugins: [],
}
