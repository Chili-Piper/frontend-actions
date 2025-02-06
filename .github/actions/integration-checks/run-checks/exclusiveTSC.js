import ts from "typescript";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";

/** Resolves the absolute path of the project's tsconfig.json file. */
function getTsConfigPath() {
  const configPath = ts.findConfigFile(
    "./",
    ts.sys.fileExists,
    "tsconfig.json"
  );
  if (!configPath) throw new Error("tsconfig.json not found");
  return configPath;
}

/** Loads and parses tsconfig.json, returning the TypeScript compiler options. */
function getTsConfig() {
  const configPath = getTsConfigPath();
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, "./");
}

function extractImportedSymbols() {
  const parsedConfig = getTsConfig();
  const program = ts.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options
  );

  const importedSymbols = new Map(); // { importedFilePath -> Set(imported symbol names) }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;

    const importingFilePath = path.resolve(sourceFile.fileName);

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
        const importedFile = ts.resolveModuleName(
          node.moduleSpecifier.text,
          importingFilePath,
          parsedConfig.options,
          ts.sys
        );

        if (importedFile.resolvedModule) {
          const importedFilePath = path.resolve(
            importedFile.resolvedModule.resolvedFileName
          );

          // Ensure there's an entry for the imported file
          if (!importedSymbols.has(importedFilePath)) {
            importedSymbols.set(importedFilePath, new Set());
          }

          const currentImports = importedSymbols.get(importedFilePath);

          // Handle named imports (import { X, Y } from 'module')
          if (
            node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings)
          ) {
            node.importClause.namedBindings.elements.forEach((el) => {
              currentImports.add(el.name.text);
            });
          }

          // Handle default imports (import DefaultExport from 'module')
          if (node.importClause?.name) {
            currentImports.add(node.importClause.name.text);
          }

          // Handle namespace imports (import * as Namespace from 'module')
          if (
            node.importClause?.namedBindings &&
            ts.isNamespaceImport(node.importClause.namedBindings)
          ) {
            currentImports.add(node.importClause.namedBindings.name.text);
          }
        }
      }
    });
  }

  return importedSymbols;
}

/** Runs `tsc --build` and extracts errors. */
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
      line: Number(line),
      column: Number(column),
      errorCode,
      message,
    };
    errorMap.set(formattedMessage, absolutePath);
  }

  return errorMap;
}

function getNodeAtLine(filePath, errorLine) {
  if (!fs.existsSync(filePath)) return null;

  const sourceCode = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.ESNext,
    true
  );

  let closestNode = null;
  let smallestRange = Number.MAX_SAFE_INTEGER;

  /** Step 1️⃣: Locate the smallest AST node covering the given error line. */
  function findSmallestNode(node) {
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(
      node.pos
    );
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(
      node.end
    );

    if (errorLine >= startLine && errorLine <= endLine) {
      const range = node.end - node.pos;
      if (range < smallestRange) {
        if (node.name?.text) {
          closestNode = node;
          smallestRange = range;
        }
      }
    }

    ts.forEachChild(node, findSmallestNode);
  }

  ts.forEachChild(sourceFile, findSmallestNode);

  return closestNode;
}

function isNodeReferencedByImportedSymbols(
  filePath,
  targetNode,
  importedSymbols
) {
  if (!targetNode) return false;
  if (!fs.existsSync(filePath)) return false;

  const sourceCode = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.ESNext,
    true
  );
  const importedNames = importedSymbols.get(filePath) || new Set();

  let isReferenced = false;
  const declarationMap = new Map(); // ✅ { identifier -> declarationNode }

  /** 1️⃣ Collect all top-level declarations and store them in `declarationMap` */
  function collectTopLevelDeclarations(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      declarationMap.set(node.name.text, node);
    }

    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((declaration) => {
        if (ts.isIdentifier(declaration.name)) {
          declarationMap.set(declaration.name.text, declaration);
        }
      });
    }

    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach((exportSpecifier) => {
          declarationMap.set(exportSpecifier.name.text, node);
        });
      }
    }
  }

  ts.forEachChild(sourceFile, collectTopLevelDeclarations);

  /**
   * 2️⃣ Traverse the AST to detect if `targetNode` is referenced inside an imported
   * function/variable.
   */
  function traverseAST(node, referencesAcc, parentImported = false) {
    if (isReferenced) return; // Stop if already found

    const nodeText = ts.isIdentifier(node)
      ? node.text
      : node.getText(sourceFile);

    // ✅ Ignore method calls like `something.test(...)`
    if (
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name === node &&
      ts.isCallExpression(node.parent.parent)
    ) {
      return;
    }

    if (referencesAcc.has(nodeText)) return; // ✅ Prevent redundant processing

    let currentNodeImported = parentImported;

    // ✅ If the node is a function/variable and it’s imported, mark it
    if (node.name && importedNames.has(node.name.text)) {
      currentNodeImported = true;
    }

    // ✅ Check if this node is `targetNode`, and if it is inside an imported scope
    if (node.name?.text === targetNode.name.text) {
      if (currentNodeImported) {
        isReferenced = true;
        return;
      }
    }

    if (declarationMap.has(nodeText)) {
      referencesAcc.add(nodeText);
    }

    // ✅ If this node is a function call, resolve and follow the function node
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calledFunction = resolveFunctionNode(node.expression);
      if (calledFunction) {
        traverseAST(calledFunction, referencesAcc, currentNodeImported);
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
    }

    // ✅ If this node is an identifier (e.g., `xa`), resolve and follow it **only if it's a global variable**
    if (ts.isIdentifier(node) && declarationMap.has(node.text)) {
      const variableDeclaration = declarationMap.get(node.text);
      traverseAST(variableDeclaration, referencesAcc, currentNodeImported);
    }

    // ✅ Traverse deeper into the AST, propagating the "imported" status
    ts.forEachChild(node, (child) =>
      traverseAST(child, referencesAcc, currentNodeImported)
    );
  }

  /** 3️⃣ Resolves the actual declaration node of a function call. */
  function resolveFunctionNode(identifierNode) {
    return declarationMap.get(identifierNode.text) || null; // ✅ Look up function in `declarationMap`
  }

  ts.forEachChild(sourceFile, (node) => {
    const acc = new Set();
    if (node.name?.text) acc.add(node.name.text);
    traverseAST(node, acc, importedNames.has(node.name?.text));
  });

  return isReferenced;
}

/** Formats error messages to resemble TypeScript's default output. */
function formatErrorMessage(error) {
  const relativePath = path.relative(process.cwd(), error.file);
  return `\x1b[1m\x1b[31m${relativePath}(${error.line},${error.column}): error ${error.errorCode}: ${error.message}\x1b[0m`;
}

/** Main function to filter errors. */
function filterErrors() {
  const importedSymbols = extractImportedSymbols();
  const errors = getTscErrors();

  const filteredErrors = [...errors.entries()]
    .map(([error, filePath]) => ({
      error,
      // line - 1 because lines in AST start at 0
      node: getNodeAtLine(filePath, error.line - 1),
      isReferenced: isNodeReferencedByImportedSymbols(
        filePath,
        getNodeAtLine(filePath, error.line - 1),
        importedSymbols
      ),
    }))
    .filter(({ isReferenced }) => isReferenced);

  if (filteredErrors.length === 0) {
    console.log(
      "\x1b[32m✔ TypeScript compilation successful. No relevant errors found.\x1b[0m"
    );
    process.exit(0);
  } else {
    console.log("\x1b[31m❌ TypeScript found errors:\x1b[0m");
    filteredErrors.forEach(({ error }) =>
      console.log(formatErrorMessage(error))
    );
    process.exit(1);
  }
}

filterErrors();
