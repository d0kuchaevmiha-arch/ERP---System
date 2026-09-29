import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Корень проекта явно: иначе Next берёт каталог с посторонним package-lock.json выше по дереву,
  // а кириллица в пути («ERP - Энерготех») ломает имена чанков Turbopack (panic в ident.rs).
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // Десктоп (§8): автономный сервер Next внутри установщика. Docker-образ пока собирается как прежде (решение P5).
  output: process.env.DESKTOP_BUILD === "1" ? "standalone" : undefined,
};

export default nextConfig;
