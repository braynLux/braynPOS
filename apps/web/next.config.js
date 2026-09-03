/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  },
  async rewrites() {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000')
      .replace(/\/+$/, '')
      .replace(/\/api\/v1$/, '')
      .replace(/\/v1$/, '')

    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/v1/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
