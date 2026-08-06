import { describe, expect, it } from 'vitest'
import { FormulaValidationError, serializeFormulaVariables, validateFormulaV2 } from './formula.js'

const valid = `
formula = "delivery"
[requires]
formula_compiler = ">=2.0.0"
[vars.request]
required = true
type = "string"
[vars.attempts]
default = 2
type = "int"
[vars.strict]
default = true
type = "bool"
[[steps]]
id = "implement"
title = "Implement"
`

describe('validateFormulaV2', () => {
  it('enforces parsed-but-unenforced variable types before dispatch', () => {
    expect(() =>
      validateFormulaV2(valid, 'delivery', { request: 'change it', attempts: 2, strict: true }),
    ).not.toThrow()
    expect(() =>
      validateFormulaV2(valid, 'delivery', { request: 'change it', attempts: '2' }),
    ).toThrow(/safe integer/)
  })

  it.each([
    ['until loop', '[steps.loop]\nuntil = "step.output == pass"\nmax = 2', /does not re-execute/],
    ['gate', '[steps.gate]\ntype = "approval"\nid = "x"', /accepted but inert/],
    ['waits_for', 'waits_for = "all-children"', /accepted but inert/],
    ['fan-out', '[steps.on_complete]\nfor_each = "output.items"\nbond = "x"', /deprecated fan-out/],
  ])('rejects %s semantics', (_name, fragment, expected) => {
    expect(() =>
      validateFormulaV2(`${valid}\n${fragment}\n`, 'delivery', { request: 'x' }),
    ).toThrow(expected)
  })

  it('requires an explicit bounded drain', () => {
    const source = `${valid}\n[steps.drain]\nformula = "item"\nmax_units = 100\n`
    expect(() => validateFormulaV2(source, 'delivery', { request: 'x' })).toThrow(
      /between 1 and 16/,
    )
  })

  it('rejects shorthand variables because Gas City cannot enforce their type', () => {
    expect(() =>
      validateFormulaV2(
        valid.replace('[vars.request]\nrequired = true\ntype = "string"', '[vars]\nrequest = ""'),
        'delivery',
        { request: 'x' },
      ),
    ).toThrow(/typed table/)
  })

  it('rejects unknown inputs and deprecated v2 opt-ins', () => {
    const source = valid.replace(
      '[requires]\nformula_compiler = ">=2.0.0"',
      'contract = "graph.v2"',
    )
    expect(() => validateFormulaV2(source, 'delivery', { request: 'x', surprise: true })).toThrow(
      FormulaValidationError,
    )
  })
})

describe('serializeFormulaVariables', () => {
  it('serializes values only after validation', () => {
    expect(serializeFormulaVariables({ count: 2, enabled: false, title: 'x' })).toEqual({
      count: '2',
      enabled: 'false',
      title: 'x',
    })
  })
})
