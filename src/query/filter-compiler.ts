import type { RowFilter } from "../storage/contracts";
import type { SearchQueryAst } from "./ast";

/**
 * FilterCompiler (PRD 15.1, 21.4): AST metadata filters become a structured
 * RowFilter. User input is never concatenated into predicate strings.
 */
export function compileFilters(ast: SearchQueryAst, base?: RowFilter): RowFilter {
  const folders: string[] = [...(base?.folders ?? [])];
  const pathContains: string[] = [...(base?.pathContains ?? [])];
  const tags: string[] = [...(base?.tags ?? [])];
  const extensions: string[] = [...(base?.extensions ?? [])];
  let mtimeBefore = base?.mtimeBefore;
  let mtimeAfter = base?.mtimeAfter;

  for (const filter of ast.filters) {
    switch (filter.kind) {
      case "folder":
        folders.push(filter.value);
        break;
      case "path":
        pathContains.push(filter.value);
        break;
      case "tag":
        tags.push(filter.value);
        break;
      case "ext":
        extensions.push(filter.value);
        break;
      case "before":
        mtimeBefore = mtimeBefore === undefined ? filter.value : Math.min(mtimeBefore, filter.value);
        break;
      case "after":
        mtimeAfter = mtimeAfter === undefined ? filter.value : Math.max(mtimeAfter, filter.value);
        break;
    }
  }

  return Object.freeze({
    ...(folders.length > 0 ? { folders: Object.freeze(folders) } : {}),
    ...(pathContains.length > 0 ? { pathContains: Object.freeze(pathContains) } : {}),
    ...(tags.length > 0 ? { tags: Object.freeze(tags) } : {}),
    ...(extensions.length > 0 ? { extensions: Object.freeze(extensions) } : {}),
    ...(mtimeBefore === undefined ? {} : { mtimeBefore }),
    ...(mtimeAfter === undefined ? {} : { mtimeAfter }),
    ...(base?.sourceIds === undefined ? {} : { sourceIds: base.sourceIds }),
    ...(base?.excludeSourceIds === undefined ? {} : { excludeSourceIds: base.excludeSourceIds })
  });
}
