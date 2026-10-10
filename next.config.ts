import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Artwork uploads from the admin (images are capped at 3 MB in the action; this leaves room for multipart overhead).
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
