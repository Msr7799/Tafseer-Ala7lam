/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        night: {
          950: '#0a0a0a',
          900: '#101010',
          850: '#171717',
          800: '#1e1e1e',
          700: '#2a2a2a'
        },
        selected: '#1e1e1e',
        paper: '#fafafa',
        ember: '#c42b1c',
        spark: '#f2c600',
        cyan: '#f2c600'
      },
      boxShadow: {
        glow: '0 30px 80px rgba(0, 0, 0, 0.45)',
        card: '0 24px 60px rgba(0, 0, 0, 0.35)'
      },
      animation: {
        float: 'float 12s ease-in-out infinite alternate',
        twinkle: 'twinkle 6s linear infinite',
        drift: 'drift 20s linear infinite'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-18px)' }
        },
        twinkle: {
          '0%, 100%': { opacity: '0.8' },
          '50%': { opacity: '0.15' }
        },
        drift: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-1600px)' }
        }
      }
    }
  },
  plugins: []
};
