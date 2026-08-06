import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LUX POS — Hybrid Edition',
    short_name: 'LUX POS',
    description: 'Enterprise AI Ingestion POS System — Robust Hybrid Performance',
    start_url: '/dashboard/pos',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0ea5e9',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
