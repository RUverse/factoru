import { describe, expect, it } from 'vitest'

import {
  parsePorcelainStatus,
  parsePorcelainStatusZ,
  previewRigRegistration,
} from './rig-safety.js'

describe('parsePorcelainStatus', () => {
  it('distinguishes staged from unstaged and untracked paths', () => {
    // Exactly the shape observed while reproducing the bd init defect: a staged
    // modification, an unstaged modification, and an untracked file.
    const output = ['M  file.txt', ' M other.txt', '?? scratch.txt'].join('\n')

    expect(parsePorcelainStatus(output)).toEqual([
      { path: 'file.txt', staged: true },
      { path: 'other.txt', staged: false },
      { path: 'scratch.txt', staged: false, untracked: true },
    ])
  })

  it('treats a path staged and modified as staged', () => {
    expect(parsePorcelainStatus('MM both.txt')).toEqual([{ path: 'both.txt', staged: true }])
  })

  it('reports the destination path of a rename', () => {
    expect(parsePorcelainStatus('R  old.txt -> new.txt')).toEqual([
      { path: 'new.txt', staged: true },
    ])
  })

  it('ignores blank and truncated lines', () => {
    expect(parsePorcelainStatus('')).toEqual([])
    expect(parsePorcelainStatus('\n\n')).toEqual([])
  })
})

describe('parsePorcelainStatusZ', () => {
  it('preserves unusual paths and consumes rename source fields', () => {
    expect(
      parsePorcelainStatusZ(
        Buffer.from('?? weird -> name\n.txt\0R  new name.txt\0old name.txt\0 M ordinary.txt\0'),
      ),
    ).toEqual([
      { path: 'weird -> name\n.txt', staged: false, untracked: true },
      { path: 'new name.txt', staged: true },
      { path: 'ordinary.txt', staged: false },
    ])
  })
})

describe('previewRigRegistration', () => {
  it('allows registration when the index is clean', () => {
    const preview = previewRigRegistration([
      { path: 'untracked.txt', staged: false },
      { path: 'modified.txt', staged: false },
    ])

    expect(preview.safe).toBe(true)
    expect(preview.blockedReason).toBeUndefined()
  })

  it('blocks registration when a staged change would be swept into the bd commit', () => {
    // The defect this guards: Gas City's `bd init` commit captured a user's
    // staged file and emptied their index. Registration must not proceed.
    const preview = previewRigRegistration([
      { path: 'file.txt', staged: true },
      { path: 'scratch.txt', staged: false },
    ])

    expect(preview.safe).toBe(false)
    expect(preview.stagedPaths).toEqual(['file.txt'])
    expect(preview.blockedReason).toContain('staged change')
  })

  it('always discloses what Gas City writes into the repository', () => {
    // The mutation list is part of the answer whether or not registration is
    // allowed, because project setup must preview it and removal must explain
    // what it is deliberately not deleting.
    for (const status of [[], [{ path: 'a.txt', staged: true }]]) {
      const preview = previewRigRegistration(status)
      expect(preview.repositoryMutations.join('\n')).toContain('.beads/')
      expect(preview.repositoryMutations.join('\n')).toContain('bd init')
    }
  })
})
