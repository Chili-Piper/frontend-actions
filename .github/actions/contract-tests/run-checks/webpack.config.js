import path from "path";

export default {
  mode: "production",
  entry: "./index.ts",
  output: {
    path: path.resolve("dist/main"),
    filename: "index.cjs",
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
