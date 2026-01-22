/**
 * AST Parser (Phase 12)
 *
 * Uses ts-morph to parse TypeScript/JavaScript files and extract structure:
 * - Functions (name, parameters, return type, JSDoc)
 * - Classes (name, methods, properties, constructor)
 * - Interfaces/Types (name, properties)
 * - Imports/Exports (for dependency graph)
 */

import {
  Project,
  SourceFile,
  FunctionDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  Node,
} from 'ts-morph';
import { existsSync } from 'fs';
import { relative, extname } from 'path';
import { isAbsolutePath } from '../lib/paths';

export interface ParameterInfo {
  name: string;
  type?: string;
  isOptional: boolean;
  defaultValue?: string;
}

export interface FunctionInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  jsdoc?: string;
  startLine: number;
  endLine: number;
}

export interface PropertyInfo {
  name: string;
  type?: string;
  isStatic: boolean;
  isReadonly: boolean;
  isOptional: boolean;
}

export interface ClassInfo {
  name: string;
  isExported: boolean;
  constructor?: FunctionInfo;
  methods: FunctionInfo[];
  properties: PropertyInfo[];
  getters: string[];
  setters: string[];
  jsdoc?: string;
  startLine: number;
  endLine: number;
}

export interface InterfaceInfo {
  name: string;
  isExported: boolean;
  properties: PropertyInfo[];
  methods: Array<{ name: string; signature: string }>;
  extends: string[];
  jsdoc?: string;
  startLine: number;
  endLine: number;
}

export interface TypeInfo {
  name: string;
  isExported: boolean;
  definition: string;
  jsdoc?: string;
  startLine: number;
  endLine: number;
}

export interface ImportInfo {
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isRelative: boolean;
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'reexport';
  isDefault: boolean;
}

export interface FileStructure {
  path: string;
  relativePath: string;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  interfaces: InterfaceInfo[];
  types: TypeInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  lineCount: number;
}

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Create a ts-morph Project for parsing
 */
export function createProject(_rootDir: string): Project {
  return new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      target: 99, // ESNext
      module: 99, // ESNext
    },
    skipAddingFilesFromTsConfig: true,
  });
}

/**
 * Parse a single file and extract its structure
 */
export function parseFile(project: Project, filePath: string, rootDir: string): FileStructure | null {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return null;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const sourceFile = project.addSourceFileAtPath(filePath);
    return extractStructure(sourceFile, filePath, rootDir);
  } catch {
    // Skip files that can't be parsed
    return null;
  }
}

/**
 * Parse multiple files
 */
export function parseFiles(filePaths: string[], rootDir: string): FileStructure[] {
  const project = createProject(rootDir);
  const structures: FileStructure[] = [];

  for (const filePath of filePaths) {
    const structure = parseFile(project, filePath, rootDir);
    if (structure) {
      structures.push(structure);
    }
  }

  return structures;
}

/**
 * Extract structure from a parsed source file
 */
function extractStructure(sourceFile: SourceFile, filePath: string, rootDir: string): FileStructure {
  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];
  const interfaces: InterfaceInfo[] = [];
  const types: TypeInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  // Extract functions
  for (const func of sourceFile.getFunctions()) {
    functions.push(extractFunctionInfo(func));
  }

  // Extract arrow functions assigned to variables at module level
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const initializer = varDecl.getInitializer();
    if (initializer && Node.isArrowFunction(initializer)) {
      const varStmt = varDecl.getVariableStatement();
      functions.push({
        name: varDecl.getName(),
        parameters: initializer.getParameters().map(p => ({
          name: p.getName(),
          type: p.getType().getText(),
          isOptional: p.isOptional(),
          defaultValue: p.getInitializer()?.getText(),
        })),
        returnType: initializer.getReturnType().getText(),
        isExported: varStmt?.isExported() ?? false,
        isAsync: initializer.isAsync(),
        jsdoc: varStmt?.getJsDocs()[0]?.getText(),
        startLine: varDecl.getStartLineNumber(),
        endLine: varDecl.getEndLineNumber(),
      });
    }
  }

  // Extract classes
  for (const cls of sourceFile.getClasses()) {
    classes.push(extractClassInfo(cls));
  }

  // Extract interfaces
  for (const iface of sourceFile.getInterfaces()) {
    interfaces.push(extractInterfaceInfo(iface));
  }

  // Extract type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    types.push(extractTypeInfo(typeAlias));
  }

  // Extract imports
  for (const imp of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    const namedImports = imp.getNamedImports().map(n => n.getName());
    const defaultImport = imp.getDefaultImport()?.getText();
    const namespaceImport = imp.getNamespaceImport()?.getText();

    imports.push({
      moduleSpecifier,
      namedImports,
      defaultImport,
      namespaceImport,
      // Use cross-platform path check for relative imports
      isRelative: moduleSpecifier.startsWith('.') || isAbsolutePath(moduleSpecifier),
    });
  }

  // Extract exports
  for (const exp of sourceFile.getExportedDeclarations()) {
    const [name, declarations] = exp;
    for (const decl of declarations) {
      let kind: ExportInfo['kind'] = 'variable';
      if (Node.isFunctionDeclaration(decl) || Node.isFunctionExpression(decl)) {
        kind = 'function';
      } else if (Node.isClassDeclaration(decl)) {
        kind = 'class';
      } else if (Node.isTypeAliasDeclaration(decl)) {
        kind = 'type';
      } else if (Node.isInterfaceDeclaration(decl)) {
        kind = 'interface';
      }

      exports.push({
        name,
        kind,
        isDefault: name === 'default',
      });
    }
  }

  // Check for re-exports
  for (const expDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = expDecl.getModuleSpecifierValue();
    if (moduleSpecifier) {
      for (const namedExport of expDecl.getNamedExports()) {
        exports.push({
          name: namedExport.getName(),
          kind: 'reexport',
          isDefault: false,
        });
      }
    }
  }

  return {
    path: filePath,
    relativePath: relative(rootDir, filePath),
    functions,
    classes,
    interfaces,
    types,
    imports,
    exports,
    lineCount: sourceFile.getEndLineNumber(),
  };
}

/**
 * Extract function information
 */
function extractFunctionInfo(func: FunctionDeclaration): FunctionInfo {
  return {
    name: func.getName() || '<anonymous>',
    parameters: func.getParameters().map(p => ({
      name: p.getName(),
      type: p.getType()?.getText(),
      isOptional: p.isOptional(),
      defaultValue: p.getInitializer()?.getText(),
    })),
    returnType: func.getReturnType()?.getText(),
    isExported: func.isExported(),
    isAsync: func.isAsync(),
    jsdoc: func.getJsDocs()[0]?.getText(),
    startLine: func.getStartLineNumber(),
    endLine: func.getEndLineNumber(),
  };
}

/**
 * Extract class information
 */
function extractClassInfo(cls: ClassDeclaration): ClassInfo {
  const methods: FunctionInfo[] = [];
  const properties: PropertyInfo[] = [];
  const getters: string[] = [];
  const setters: string[] = [];
  let constructor: FunctionInfo | undefined;

  // Extract constructor
  const ctor = cls.getConstructors()[0];
  if (ctor) {
    constructor = {
      name: 'constructor',
      parameters: ctor.getParameters().map(p => ({
        name: p.getName(),
        type: p.getType()?.getText(),
        isOptional: p.isOptional(),
        defaultValue: p.getInitializer()?.getText(),
      })),
      returnType: undefined,
      isExported: false,
      isAsync: false,
      jsdoc: ctor.getJsDocs()[0]?.getText(),
      startLine: ctor.getStartLineNumber(),
      endLine: ctor.getEndLineNumber(),
    };
  }

  // Extract methods
  for (const method of cls.getMethods()) {
    methods.push({
      name: method.getName(),
      parameters: method.getParameters().map(p => ({
        name: p.getName(),
        type: p.getType()?.getText(),
        isOptional: p.isOptional(),
        defaultValue: p.getInitializer()?.getText(),
      })),
      returnType: method.getReturnType()?.getText(),
      isExported: false,
      isAsync: method.isAsync(),
      jsdoc: method.getJsDocs()[0]?.getText(),
      startLine: method.getStartLineNumber(),
      endLine: method.getEndLineNumber(),
    });
  }

  // Extract properties
  for (const prop of cls.getProperties()) {
    properties.push({
      name: prop.getName(),
      type: prop.getType()?.getText(),
      isStatic: prop.isStatic(),
      isReadonly: prop.isReadonly(),
      isOptional: prop.hasQuestionToken(),
    });
  }

  // Extract getters
  for (const getter of cls.getGetAccessors()) {
    getters.push(getter.getName());
  }

  // Extract setters
  for (const setter of cls.getSetAccessors()) {
    setters.push(setter.getName());
  }

  return {
    name: cls.getName() || '<anonymous>',
    isExported: cls.isExported(),
    constructor,
    methods,
    properties,
    getters,
    setters,
    jsdoc: cls.getJsDocs()[0]?.getText(),
    startLine: cls.getStartLineNumber(),
    endLine: cls.getEndLineNumber(),
  };
}

/**
 * Extract interface information
 */
function extractInterfaceInfo(iface: InterfaceDeclaration): InterfaceInfo {
  const properties: PropertyInfo[] = [];
  const methods: Array<{ name: string; signature: string }> = [];

  // Extract properties
  for (const prop of iface.getProperties()) {
    properties.push({
      name: prop.getName(),
      type: prop.getType()?.getText(),
      isStatic: false,
      isReadonly: prop.isReadonly(),
      isOptional: prop.hasQuestionToken(),
    });
  }

  // Extract methods
  for (const method of iface.getMethods()) {
    methods.push({
      name: method.getName(),
      signature: method.getText(),
    });
  }

  // Get extended interfaces
  const extendsExprs = iface.getExtends().map(e => e.getText());

  return {
    name: iface.getName(),
    isExported: iface.isExported(),
    properties,
    methods,
    extends: extendsExprs,
    jsdoc: iface.getJsDocs()[0]?.getText(),
    startLine: iface.getStartLineNumber(),
    endLine: iface.getEndLineNumber(),
  };
}

/**
 * Extract type alias information
 */
function extractTypeInfo(typeAlias: TypeAliasDeclaration): TypeInfo {
  return {
    name: typeAlias.getName(),
    isExported: typeAlias.isExported(),
    definition: typeAlias.getType().getText(),
    jsdoc: typeAlias.getJsDocs()[0]?.getText(),
    startLine: typeAlias.getStartLineNumber(),
    endLine: typeAlias.getEndLineNumber(),
  };
}

/**
 * Get a summary of the file structure (for embedding)
 */
export function getStructureSummary(structure: FileStructure): string {
  const lines: string[] = [];
  lines.push(`File: ${structure.relativePath}`);

  if (structure.exports.length > 0) {
    const exportNames = structure.exports.map(e => e.name).join(', ');
    lines.push(`Exports: ${exportNames}`);
  }

  if (structure.functions.length > 0) {
    lines.push('Functions:');
    for (const func of structure.functions) {
      const params = func.parameters.map(p => p.name).join(', ');
      const async = func.isAsync ? 'async ' : '';
      lines.push(`  ${async}${func.name}(${params})`);
    }
  }

  if (structure.classes.length > 0) {
    lines.push('Classes:');
    for (const cls of structure.classes) {
      lines.push(`  ${cls.name}`);
      if (cls.constructor) {
        const params = cls.constructor.parameters.map(p => p.name).join(', ');
        lines.push(`    constructor(${params})`);
      }
      for (const method of cls.methods) {
        const params = method.parameters.map(p => p.name).join(', ');
        lines.push(`    ${method.name}(${params})`);
      }
    }
  }

  if (structure.interfaces.length > 0) {
    lines.push('Interfaces:');
    for (const iface of structure.interfaces) {
      const props = iface.properties.map(p => p.name).join(', ');
      lines.push(`  ${iface.name} { ${props} }`);
    }
  }

  if (structure.types.length > 0) {
    lines.push('Types:');
    for (const type of structure.types) {
      lines.push(`  ${type.name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Find files that might be related to a query
 */
export function findRelatedFiles(
  structures: FileStructure[],
  query: string
): FileStructure[] {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(k => k.length > 2);

  return structures.filter(structure => {
    // Check file path
    if (structure.relativePath.toLowerCase().includes(queryLower)) {
      return true;
    }

    // Check function names
    for (const func of structure.functions) {
      if (func.name.toLowerCase().includes(queryLower)) {
        return true;
      }
      for (const keyword of keywords) {
        if (func.name.toLowerCase().includes(keyword)) {
          return true;
        }
      }
    }

    // Check class names
    for (const cls of structure.classes) {
      if (cls.name.toLowerCase().includes(queryLower)) {
        return true;
      }
      for (const keyword of keywords) {
        if (cls.name.toLowerCase().includes(keyword)) {
          return true;
        }
      }
    }

    // Check interface names
    for (const iface of structure.interfaces) {
      if (iface.name.toLowerCase().includes(queryLower)) {
        return true;
      }
    }

    // Check type names
    for (const type of structure.types) {
      if (type.name.toLowerCase().includes(queryLower)) {
        return true;
      }
    }

    // Check export names
    for (const exp of structure.exports) {
      if (exp.name.toLowerCase().includes(queryLower)) {
        return true;
      }
    }

    return false;
  });
}
