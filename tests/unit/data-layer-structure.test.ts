import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../src/server/data/permissions";

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

function sourceFile(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function exportedFunctionDetails(
  fileName: string,
  source: string,
): {
  name: string;
  parameters: { name: string; type: string | undefined }[];
}[] {
  const parsed = sourceFile(fileName, source);
  const functions: {
    name: string;
    parameters: { name: string; type: string | undefined }[];
  }[] = [];

  const addFunction = (
    name: string,
    parameters: readonly ts.ParameterDeclaration[],
  ) => {
    functions.push({
      name,
      parameters: parameters.map((parameter) => ({
        name: parameter.name.getText(parsed),
        type: parameter.type?.getText(parsed),
      })),
    });
  };

  for (const statement of parsed.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name
    ) {
      addFunction(statement.name.text, statement.parameters);
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer))
        ) {
          addFunction(declaration.name.text, initializer.parameters);
        }
      }
    }
  }

  return functions;
}

function exportedFunctionParameterTypes(
  fileName: string,
  source: string,
): { name: string; parameterTypes: string[] }[] {
  return exportedFunctionDetails(fileName, source).map((fn) => ({
    name: fn.name,
    parameterTypes: fn.parameters.flatMap((parameter) =>
      parameter.type ? [parameter.type] : [],
    ),
  }));
}

function checkedFunctionFiles(): string[] {
  const fixtureDirectory = join(process.cwd(), "tests", "fixtures");
  const fixtures = existsSync(fixtureDirectory) ? dataFiles(fixtureDirectory) : [];
  return [...dataFiles(dataDirectory), ...fixtures].sort();
}

function genericSignatureViolations(fileName: string, source: string): string[] {
  if (fileName.endsWith("/scope.ts")) return [];

  return exportedFunctionDetails(fileName, source).flatMap((fn) => {
    const [first, second] = fn.parameters;
    const violations: string[] = [];

    if (first?.name !== "scope") {
      violations.push(
        `${fileName}: ${fn.name} first parameter name is ${first ? `"${first.name}"` : "none"}, expected "scope"`,
      );
    }
    if (first?.type !== "DataScope") {
      violations.push(
        `${fileName}: ${fn.name} first parameter type is ${first?.type ? `"${first.type}"` : "none"}, expected "DataScope"`,
      );
    }
    if (second?.name !== "access") {
      violations.push(
        `${fileName}: ${fn.name} second parameter name is ${second ? `"${second.name}"` : "none"}, expected "access"`,
      );
    }
    if (second?.type !== "AuthorizedBranch") {
      violations.push(
        `${fileName}: ${fn.name} second parameter type is ${second?.type ? `"${second.type}"` : "none"}, expected "AuthorizedBranch"`,
      );
    }
    for (const parameter of fn.parameters) {
      if (parameter.name === "branchId" || parameter.name === "organizationId") {
        violations.push(
          `${fileName}: ${fn.name} has forbidden parameter "${parameter.name}"`,
        );
      }
    }

    return violations;
  });
}

function authorizedBranchViolations(fileName: string, source: string): string[] {
  return exportedFunctionParameterTypes(fileName, source)
    .filter((fn) => !fn.parameterTypes.includes("AuthorizedBranch"))
    .map((fn) => `${fileName}: ${fn.name} has no AuthorizedBranch parameter`);
}

function textLineViolations(
  fileName: string,
  source: string,
  text: string,
): string[] {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) =>
      line.includes(text) ? [`${fileName}:${index + 1} contains "${text}"`] : [],
    );
}

function permissionLiteralViolations(
  fileName: string,
  source: string,
  allowed: Set<string>,
): string[] {
  const parsed = sourceFile(fileName, source);
  const violations: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      allowed.has(node.text)
    ) {
      const position = parsed.getLineAndCharacterOfPosition(
        node.getStart(parsed),
      );
      violations.push(
        `${fileName}:${position.line + 1}:${position.character + 1} literal "${node.text}"`,
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
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

  it("exported functions in audit.ts and terminals.ts require AuthorizedBranch", () => {
    const violations = ["audit.ts", "terminals.ts"].flatMap((name) => {
      const filePath = join(dataDirectory, name);
      const fileName = relative(process.cwd(), filePath).replace(/\\/g, "/");
      return authorizedBranchViolations(fileName, readFileSync(filePath, "utf8"));
    });

    expect(
      violations,
      `AuthorizedBranch parameter violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("only scope.ts contains as AuthorizedBranch under src/server/data", () => {
    const violations = dataFiles(dataDirectory).flatMap((file) => {
      const fileName = relative(process.cwd(), file).replace(/\\/g, "/");
      if (fileName.endsWith("/scope.ts")) return [];
      return textLineViolations(
        fileName,
        readFileSync(file, "utf8"),
        "as AuthorizedBranch",
      );
    });

    expect(
      violations,
      `as AuthorizedBranch violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("no permission string literals exist outside permissions.ts", () => {
    const allowed = new Set<string>(Object.values(PERMISSIONS));
    const violations = dataFiles(dataDirectory).flatMap((file) => {
      const fileName = relative(process.cwd(), file).replace(/\\/g, "/");
      if (fileName.endsWith("/permissions.ts")) return [];
      return permissionLiteralViolations(
        fileName,
        readFileSync(file, "utf8"),
        allowed,
      );
    });

    expect(
      violations,
      `permission literal violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("a plain string is rejected where AuthorizedBranch is required", () => {
    const fixtureDirectory = join(process.cwd(), "tests", "fixtures");
    const fixturePath = join(fixtureDirectory, "bad-call.ts");
    const configPath = join(fixtureDirectory, "tsconfig.json");

    mkdirSync(fixtureDirectory, { recursive: true });
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          extends: "../../tsconfig.json",
          compilerOptions: { incremental: false, noEmit: true },
          include: ["bad-call.ts"],
          exclude: [],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      fixturePath,
      `import type { DataScope } from "../../src/server/data/scope";\nimport { listAuditEvents } from "../../src/server/data/audit";\n\nconst scope = {} as DataScope;\nvoid listAuditEvents(scope, "plain-branch-id", { limit: 10 });\n`,
    );

    try {
      const command = process.platform === "win32" ? "cmd.exe" : "sh";
      const args =
        process.platform === "win32"
          ? ["/c", "npx", "tsc", "--noEmit", "--project", "tests/fixtures/tsconfig.json"]
          : [
              "-c",
              "npx tsc --noEmit --project tests/fixtures/tsconfig.json",
            ];
      const result = spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

      expect(result.status, `tsc output:\n${output}`).not.toBe(0);
      expect(output, `tsc output:\n${output}`).toContain("bad-call.ts");
      expect(output, `tsc output:\n${output}`).toContain("AuthorizedBranch");
    } finally {
      rmSync(fixturePath, { force: true });
      rmSync(configPath, { force: true });
    }
  }, 30000);

  it("every exported data function except scope.ts has scope: DataScope and access: AuthorizedBranch", () => {
    const violations = checkedFunctionFiles().flatMap((file) => {
      const fileName = relative(process.cwd(), file).replace(/\\/g, "/");
      return genericSignatureViolations(fileName, readFileSync(file, "utf8"));
    });

    expect(
      violations,
      `exported data function signature violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
