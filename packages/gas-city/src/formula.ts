import { parse } from 'smol-toml'

export type FormulaVariableValue = string | number | boolean

export class FormulaValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Formula validation failed: ${issues.join('; ')}`)
    this.name = 'FormulaValidationError'
    this.issues = issues
  }
}

interface FormulaVariableDefinition {
  readonly required?: unknown
  readonly default?: unknown
  readonly enum?: unknown
  readonly pattern?: unknown
  readonly type?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function visit(
  value: unknown,
  path: string,
  visitor: (key: string, value: unknown, path: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, visitor))
    return
  }
  const object = record(value)
  if (!object) return
  for (const [key, child] of Object.entries(object)) {
    const childPath = path ? `${path}.${key}` : key
    visitor(key, child, childPath)
    visit(child, childPath, visitor)
  }
}

function validateVariable(
  name: string,
  definitionValue: unknown,
  supplied: Readonly<Record<string, FormulaVariableValue>>,
  issues: string[],
): void {
  if (typeof definitionValue === 'string') {
    issues.push(`vars.${name} must use a typed table, not shorthand`)
    return
  }
  const definition = record(definitionValue) as FormulaVariableDefinition | null
  if (!definition) {
    issues.push(`vars.${name} must be a string default or table`)
    return
  }
  const hasValue = Object.hasOwn(supplied, name)
  const value = hasValue ? supplied[name] : definition.default
  if (definition.required === true && !hasValue) {
    issues.push(`vars.${name} is required`)
    return
  }
  if (value === undefined) return

  switch (definition.type) {
    case 'string':
      if (typeof value !== 'string') issues.push(`vars.${name} must be a string`)
      break
    case 'int':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        issues.push(`vars.${name} must be a safe integer`)
      }
      break
    case 'bool':
      if (typeof value !== 'boolean') issues.push(`vars.${name} must be a boolean`)
      break
    default:
      issues.push(`vars.${name} must declare type string, int, or bool`)
  }

  if (Array.isArray(definition.enum) && !definition.enum.includes(value)) {
    issues.push(`vars.${name} is not an allowed value`)
  }
  if (typeof definition.pattern === 'string' && typeof value === 'string') {
    try {
      if (!new RegExp(definition.pattern).test(value)) {
        issues.push(`vars.${name} does not match its declared pattern`)
      }
    } catch {
      issues.push(`vars.${name} has an invalid pattern`)
    }
  }
}

/**
 * Factoru-side policy above Gas City 1.4.0's Formula v2 parser.
 *
 * The pinned runtime parses variable types without enforcing them and accepts
 * several inert control-flow shapes. A run is rejected before any durable Gas
 * City write unless both the recipe and the supplied values satisfy this
 * stricter contract.
 */
export function validateFormulaV2(
  source: string,
  expectedName: string,
  supplied: Readonly<Record<string, FormulaVariableValue>>,
): void {
  let formula: Record<string, unknown>
  try {
    formula = record(parse(source)) ?? {}
  } catch (error) {
    throw new FormulaValidationError([
      `TOML could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }

  const issues: string[] = []
  if (formula['formula'] !== expectedName) {
    issues.push(`formula name must be ${expectedName}`)
  }
  const requires = record(formula['requires'])
  if (requires?.['formula_compiler'] !== '>=2.0.0') {
    issues.push('requires.formula_compiler must be >=2.0.0')
  }
  if (formula['contract'] !== undefined) {
    issues.push('deprecated contract opt-in is not allowed')
  }
  if (formula['type'] === 'converge' || formula['converge'] !== undefined) {
    issues.push('Formula v2 convergence is not supported')
  }

  visit(formula, '', (key, value, path) => {
    if (key === 'waits_for' || key === 'gate') {
      issues.push(`${path} is accepted but inert in Gas City 1.4.0`)
    }
    if (key === 'until') {
      issues.push(`${path} does not re-execute in Gas City 1.4.0; use check`)
    }
    if (key === 'on_complete') {
      issues.push(`${path} uses deprecated fan-out; use drain`)
    }
    if (key === 'drain') {
      const drain = record(value)
      const maxUnits = drain?.['max_units']
      if (!Number.isInteger(maxUnits) || Number(maxUnits) < 1 || Number(maxUnits) > 16) {
        issues.push(`${path}.max_units must explicitly cap fan-out between 1 and 16`)
      }
    }
  })

  const vars = record(formula['vars']) ?? {}
  for (const name of Object.keys(supplied)) {
    if (!Object.hasOwn(vars, name)) issues.push(`unknown variable ${name}`)
  }
  for (const [name, definition] of Object.entries(vars)) {
    validateVariable(name, definition, supplied, issues)
  }

  if (issues.length > 0) throw new FormulaValidationError(issues)
}

export function serializeFormulaVariables(
  values: Readonly<Record<string, FormulaVariableValue>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
}
