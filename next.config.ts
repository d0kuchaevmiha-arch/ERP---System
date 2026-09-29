import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Корень проекта явно: иначе Next берёт каталог с посторонним package-lock.json выше по дереву,
  // а кириллица в пути («ERP - Энерготех») ломает имена чанков Turbopack (panic в ident.rs).
  turbopack: { root: __dirname },
};

export default nextConfig;
