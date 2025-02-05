import ts from "typescript";
import { execFileSync } from "child_process";
import path from "path";

// This is a version of TSC command which removes errors from files that are not directly imported
// by current project. This is needed because tsc with project references builds referenced packages
// and reports errors for all files regardless if they are actually used or not. This helps reducing
// false positives.

// Function to extract all imported files
function getImportedFiles() {
  const configPath = ts.findConfigFile(
    "./",
    ts.sys.fileExists,
    "tsconfig.json"
  );
  if (!configPath) throw new Error("tsconfig.json not found");

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    "./"
  );

  const program = ts.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options
  );
  const importedFiles = new Set();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue; // Skip .d.ts files

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
        const importPath = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(
          importPath,
          sourceFile.fileName,
          parsedConfig.options,
          ts.sys
        );
        if (resolved.resolvedModule)
          importedFiles.add(
            path.resolve(resolved.resolvedModule.resolvedFileName)
          );
      }
    });
  }

  return importedFiles;
}

// Function to run `tsc` and extract errors
function getTscErrors() {
  let tscOutput;
  try {
    tscOutput = execFileSync("yarn", ["tsc", "--build", "--pretty", "false"], {
      encoding: "utf-8",
    });
  } catch (error) {
    tscOutput = error.stdout || "";
  }

  const errorMap = new Map();
  const errorRegex = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm;
  let match;
  while ((match = errorRegex.exec(tscOutput)) !== null) {
    const [_, relativePath, line, column, errorCode, message] = match;
    const absolutePath = path.resolve(process.cwd(), relativePath);
    const formattedMessage = {
      file: absolutePath,
      line,
      column,
      errorCode,
      message,
    };
    errorMap.set(formattedMessage, absolutePath);
  }

  return errorMap;
}

// Function to format TypeScript-style error messages
function formatErrorMessage(error) {
  const relativePath = path.relative(process.cwd(), error.file);
  return `\x1b[1m\x1b[31m${relativePath}(${error.line},${error.column}): error ${error.errorCode}: ${error.message}\x1b[0m`;
}

// Main function to filter errors
function filterErrors() {
  const importedFiles = getImportedFiles();
  const errors = getTscErrors();

  const filteredErrors = [...errors.entries()]
    .filter(([_, filePath]) => importedFiles.has(filePath))
    .map(([error]) => error);

  if (filteredErrors.length === 0) {
    console.log(
      "\x1b[32m✔ TypeScript compilation successful. No relevant errors found.\x1b[0m"
    );
    process.exit(0);
  } else {
    console.log("\x1b[31m❌ TypeScript found errors:\x1b[0m");
    filteredErrors.forEach((error) => console.log(formatErrorMessage(error)));
    process.exit(1);
  }
}

filterErrors();
