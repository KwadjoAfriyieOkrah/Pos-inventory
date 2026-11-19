import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const dataDirectory = join(process.cwd(), "src", "server", "data");

function dataFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...dataFiles(fullPath));
    else if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files.sort();
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function exportedFunctions(
  fileName: string,
  source: string,
): { name: string; firstParameter: string | undefined }[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const functions: { name: string; firstParameter: string | undefined }[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name
    ) {
      functions.push({
        name: statement.name.text,
        firstParameter: statement.parameters[0]?.name.getText(sourceFile),
      });
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          functions.push({
            name: declaration.name.text,
            firstParameter: initializer.parameters[0]?.name.getText(sourceFile),
          });
        }
      }
    }
  }

  return functions;
}

function scopeParameterViolations(fileName: string, source: string): string[] {
  return exportedFunctions(fileName, source)
    .filter((fn) => fn.firstParameter !== "scope")
    .map((fn) => {
      const found = fn.firstParameter === undefined
        ? "none"
        : `"${fn.firstParameter}"`;
      return `${fileName}: ${fn.name} first parameter is ${found}, expected "scope"`;
    });
}

function exportedNames(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    if (isExported(statement)) {
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        statement.name
      ) {
        names.push(statement.name.text);
        continue;
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            names.push(declaration.name.text);
          }
        }
        continue;
      }
    }

    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          names.push(element.name.text);
        }
      } else if (!clause) {
        names.push("*");
      }
    }
  }

  return names;
}

describe("data layer structure", () => {
  it("every exported function in src/server/data has scope as its first parameter", () => {
    const violations = dataFiles(dataDirectory).flatMap((file) => {
      const fileName = relative(process.cwd(), file).replace(/\\/g, "/");
      return scopeParameterViolations(fileName, readFileSync(file, "utf8"));
    });

    expect(
      violations,
      `scope parameter violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("the checker flags an exported listAllUsers() with no scope parameter", () => {
    const source = 'export function listAllUsers() {\n  return [];\n}\n';
    expect(
      scopeParameterViolations("src/server/data/unscoped-helpers.ts", source),
    ).toEqual([
      'src/server/data/unscoped-helpers.ts: listAllUsers first parameter is none, expected "scope"',
    ]);
  });

  it("loadScope is exported from auth/scope.ts and not from src/server/data", () => {
    const authPath = join(process.cwd(), "src", "server", "auth", "scope.ts");
    const authName = relative(process.cwd(), authPath).replace(/\\/g, "/");
    const authNames = exportedNames(authName, readFileSync(authPath, "utf8"));
    expect(authNames, `${authName} exports`).toContain("loadScope");

    const leaks = dataFiles(dataDirectory).flatMap((file) => {
      const fileName = relative(process.cwd(), file).replace(/\\/g, "/");
      return exportedNames(fileName, readFileSync(file, "utf8"))
        .filter((name) => name === "loadScope" || name === "*")
        .map((name) => `${fileName} exports ${name}`);
    });

    expect(leaks, `loadScope leaks:\n${leaks.join("\n")}`).toEqual([]);
  });
});
