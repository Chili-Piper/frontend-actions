import path from "path";

export default {
  mode: "production",
  entry: {
    main: "./src/main.ts",
    post: "./src/post.ts",
    restore: "./src/restore.ts",
    save: "./src/save.ts",
  },
  output: {
    path: path.resolve("dist"),
    filename: "[name]/index.cjs",
    libraryTarget: "commonjs2",
  },
  target: "node",
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  optimization: {
    minimize: false,
  },
};
