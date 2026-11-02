/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native/node-only packages out of the webpack bundle; require at runtime.
  serverExternalPackages: ["pg", "@napi-rs/canvas", "pdfkit"],
};

export default nextConfig;
