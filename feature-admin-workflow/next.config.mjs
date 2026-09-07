/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_OUTPUT_STANDALONE === "true"
    ? { output: "standalone" }
    : {}),
  experimental: {
    useWasmBinary: true
  }
};

export default nextConfig;
