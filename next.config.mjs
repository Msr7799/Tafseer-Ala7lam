const nextConfig = {
  typedRoutes: false,
  turbopack: {},
  webpack(config) {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [
        "**/node_modules/**",
        "**/.next/**",
        "**/data/rag/**",
        "**/Al_Saheehan/**",
        "**/Ta_teer_Al_Anam_Fi_Tabeer_Al_Manam/**",
        "**/Tabeer_Al_Roya/**",
        "**/Tafseer_AlAhlam_AlKabeer_BnSereen/**",
        "**/*_djvu.xml",
        "**/*_djvu.txt",
        "**/*.pdf",
        "**/*.epub",
        "**/*.zip",
        "**/*.gz"
      ]
    };
    return config;
  }
};

export default nextConfig;
