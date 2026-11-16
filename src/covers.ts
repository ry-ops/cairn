// Edition colors for notebook covers. Stored by name in notebook.yml `color`.
export interface Edition {
  name: string;
  label: string;
  /** Cover stock. */
  stock: string;
  /** Printing ink on the cover. */
  ink: string;
}

export const EDITIONS: Edition[] = [
  { name: "kraft", label: "Kraft", stock: "#c49a6c", ink: "#2b2118" },
  { name: "blaze", label: "Blaze", stock: "#e0662f", ink: "#24140c" },
  { name: "pine", label: "Pine", stock: "#3f5b45", ink: "#efe6d2" },
  { name: "lake", label: "Lake Superior", stock: "#2f4f6b", ink: "#efe6d2" },
  { name: "birch", label: "Birch", stock: "#e9e2d0", ink: "#2b2a26" },
  { name: "graphite", label: "Graphite", stock: "#34363a", ink: "#e8c547" },
  { name: "cherry", label: "Cherry", stock: "#9b2d30", ink: "#f2e7d5" },
];

export const edition = (name: string): Edition =>
  EDITIONS.find((e) => e.name === name) ?? EDITIONS[0];
