export type Cardinality = 'one' | 'many';

export type ScalarType =
  | 'Text'
  | 'Integer'
  | 'Number'
  | 'Boolean'
  | 'Date'
  | 'DateTime'
  | 'Time'
  | 'Duration'
  | 'URL';

export type FieldSpec =
  | { kind: 'scalar'; type: ScalarType; cardinality: Cardinality }
  | { kind: 'enum'; values: readonly string[]; cardinality: Cardinality }
  | { kind: 'ref'; targets: readonly string[]; cardinality: Cardinality }
  | { kind: 'embed'; type: string; cardinality: Cardinality };

export interface LanguageValue {
  '@type': 'Language';
  alternateName?: string;
  name?: string;
}

export interface ErrorResponse {
  status: number;
  error: string;
  message: string;
  details: string[];
  path: string;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}
