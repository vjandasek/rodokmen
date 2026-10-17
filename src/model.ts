/** Shape of the data files (data/family*.json), written by the editor (edit.ts `serialize`). */
export interface PartnerRef {
  id: number;
  married: boolean;
  /** Order among the person's partners (0 = first). */
  order: number;
}

export interface Person {
  id: number;
  firstName: string;
  lastName: string | null;
  maidenName: string | null;
  sex: 'M' | 'F';
  living: boolean;
  bloodRelated: boolean;
  /** The blood-related parent; defines the tree. */
  parentBlood: number | null;
  /** The other parent, a partner of parentBlood. */
  parentNotBlood: number | null;
  /** Only filled on the blood-related side of a partnership. */
  partners: PartnerRef[];
  /** Details from the legacy DB (format version 2); dates strictly 'dd.mm.yyyy'. Not drawn yet. */
  title?: string | null;
  bornDate?: string | null;
  bornPlace?: string | null;
  deathDate?: string | null;
  deathPlace?: string | null;
}

export interface FamilyFile {
  version: number;
  rootId: number;
  people: Person[];
}

/** A blood-related person in the descendant tree. Partners are attached, not tree nodes. */
export interface TreeNode {
  person: Person;
  partners: Person[];
  children: TreeNode[];
  parent: TreeNode | null;
  level: number;
}

export function buildTree(file: FamilyFile): TreeNode {
  const byId = new Map(file.people.map((p) => [p.id, p]));
  const childrenOf = new Map<number, Person[]>();
  for (const p of file.people) {
    if (p.parentBlood === null) continue;
    const list = childrenOf.get(p.parentBlood) ?? [];
    list.push(p);
    childrenOf.set(p.parentBlood, list);
  }

  const rootPerson = byId.get(file.rootId);
  if (!rootPerson) throw new Error(`Root ${file.rootId} not found`);

  const visited = new Set<number>();
  const make = (person: Person, parent: TreeNode | null, level: number): TreeNode => {
    if (visited.has(person.id)) throw new Error(`Cycle at person ${person.id}`);
    visited.add(person.id);

    const partnerRefs = [...person.partners].sort((a, b) => a.order - b.order);
    const partners = partnerRefs.map((r) => {
      const partner = byId.get(r.id);
      if (!partner) throw new Error(`Partner ${r.id} of ${person.id} not found`);
      return partner;
    });
    const node: TreeNode = { person, partners, children: [], parent, level };

    // Group children by the partner they come from (partner order), then by id.
    const partnerRank = (c: Person) => {
      const i = partners.findIndex((p) => p.id === c.parentNotBlood);
      return i < 0 ? partners.length : i;
    };
    const kids = [...(childrenOf.get(person.id) ?? [])].sort(
      (a, b) => partnerRank(a) - partnerRank(b) || a.id - b.id,
    );
    node.children = kids.map((c) => make(c, node, level + 1));
    return node;
  };

  return make(rootPerson, null, 0);
}

export function* walk(node: TreeNode): Generator<TreeNode> {
  yield node;
  for (const c of node.children) yield* walk(c);
}
