// Synthetic Petstore-style REST API used to exercise every codegen
// feature: path params, query params, optional params, body, headers,
// pagination, all the HTTP verbs.

interface Pet {
  id: number;
  name: string;
  status: string;
  tags: string[];
}

interface CreatePetParams {
  name: string;
  status: string;
}

interface PetList {
  data: Pet[];
  next_cursor: string;
}

interface UploadResult {
  id: string;
  size: number;
}

// @rest baseUrl=http://localhost:0
// @auth bearer
// @retries count=2 backoff=exponential
interface PetstoreAPI {
  // @get /pets/{id}
  getPet(id: number): Promise<Pet>;

  // @get /pets
  // @query limit
  // @query status
  listPets(limit?: number, status?: string): Promise<PetList>;

  // @get /pets
  // @query status
  // @paginated cursor=after items=data next=next_cursor
  streamPets(status?: string): AsyncIterable<Pet>;

  // @post /pets
  // @body body
  createPet(body: CreatePetParams): Promise<Pet>;

  // @put /pets/{id}
  // @body body
  updatePet(id: number, body: CreatePetParams): Promise<Pet>;

  // @delete /pets/{id}
  deletePet(id: number): Promise<void>;

  // @get /pets/{id}/avatar
  // @decode arrayBuffer
  getPetAvatar(id: number): Promise<ArrayBuffer>;

  // @post /upload
  // @bodyencoding multipart
  // @body form
  uploadFile(form: FormData): Promise<UploadResult>;

  // @get /search
  // @query q
  // @header X-Trace-Id traceId
  search(q: string, traceId?: string): Promise<Pet[]>;
}
