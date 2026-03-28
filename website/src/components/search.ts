/*
 * TOC search powered by Orama — full-text, typo-tolerant, in-memory.
 * Reference: https://www.mintlify.com/oramasearch/orama/quickstart.md
 *
 * Data model: flat SearchEntry[] array (not a tree). Each entry carries its
 * parentHref and groupIndex so we can derive which TOC groups to expand and
 * which items to dim without walking a tree structure. This scales to thousands
 * of entries — Orama searches in ~20us and the derive pass is a single O(n) filter.
 *
 * Future: when pages are added to the left tree, they become entries with
 * level 0 or a `type: 'page'` field. The same flat model + derive logic works.
 */

import { create, insertMultiple, search, type AnyOrama } from '@orama/orama'
import type { TocItem, HeadingLevel } from './markdown.js'

export type SearchEntry = {
  title: string
  href: string
  level: HeadingLevel
  parentHref: string | null
  groupIndex: number
}

/** Build a flat SearchEntry[] from TocItem[], tracking the current level-1 parent. */
export function buildSearchEntries({ items }: { items: TocItem[] }): SearchEntry[] {
  let currentParentHref: string | null = null
  let groupIndex = -1

  return items.map((item) => {
    const level = item.level ?? 1
    if (level === 1) {
      currentParentHref = item.href
      groupIndex++
    }
    return {
      title: item.label,
      href: item.href,
      level: level as HeadingLevel,
      parentHref: level === 1 ? null : currentParentHref,
      groupIndex,
    }
  })
}

const tocSchema = {
  title: 'string',
} as const

/** Create and populate an Orama DB from search entries. Synchronous. */
export function createTocDb({ entries }: { entries: SearchEntry[] }): AnyOrama {
  const db = create({ schema: tocSchema })
  /* insertMultiple is sync with default components. We cast away the union
     return type since we know no async components are configured. */
  insertMultiple(db, entries.map((e) => {
    return { title: e.title }
  })) as string[]
  return db
}

export type SearchState = {
  /** Set of hrefs that matched the query. null = no active search. */
  matchedHrefs: Set<string> | null
  /** Set of group parent hrefs to force-expand. null = no override. */
  expandOverride: Set<string> | null
  /** Set of hrefs to dim (opacity 0.3). null = no dimming. */
  dimmedHrefs: Set<string> | null
  /** Ordered list of hrefs that are focusable via arrow keys. null = all focusable. */
  focusableHrefs: string[] | null
}

const emptySearchState: SearchState = {
  matchedHrefs: null,
  expandOverride: null,
  dimmedHrefs: null,
  focusableHrefs: null,
}

/** Search the TOC DB. Returns null matchedHrefs when query is empty (show all). */
export function searchToc({ db, query, entries }: {
  db: AnyOrama
  query: string
  entries: SearchEntry[]
}): SearchState {
  const trimmed = query.trim()
  if (!trimmed) {
    return emptySearchState
  }

  const results = search(db, {
    term: trimmed,
    properties: ['title'],
    tolerance: 1,
    limit: entries.length,
  }) as { hits: Array<{ id: string; score: number; document: { title: string } }> }

  if (results.hits.length === 0) {
    return {
      matchedHrefs: new Set(),
      expandOverride: new Set(),
      dimmedHrefs: new Set(entries.map((e) => { return e.href })),
      focusableHrefs: [],
    }
  }

  /* Map matched titles back to hrefs. Orama doesn't store our custom fields,
     so we match by title. For identical titles this is fine — both would match. */
  const matchedTitles = new Set(results.hits.map((h) => { return h.document.title }))

  const matchedHrefs = new Set<string>()
  const expandOverride = new Set<string>()

  for (const entry of entries) {
    if (matchedTitles.has(entry.title)) {
      matchedHrefs.add(entry.href)
      /* Expand the parent group for this match */
      if (entry.parentHref) {
        expandOverride.add(entry.parentHref)
      } else {
        /* Level-1 item matched — expand itself (its own children become visible) */
        expandOverride.add(entry.href)
      }
    }
  }

  const dimmedHrefs = new Set(
    entries
      .filter((e) => { return !matchedHrefs.has(e.href) })
      .map((e) => { return e.href }),
  )

  /* Focusable in document order — only matched items */
  const focusableHrefs = entries
    .filter((e) => { return matchedHrefs.has(e.href) })
    .map((e) => { return e.href })

  return { matchedHrefs, expandOverride, dimmedHrefs, focusableHrefs }
}
