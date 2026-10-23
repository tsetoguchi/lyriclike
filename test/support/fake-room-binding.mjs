// Stands in for the PAGE_ROOM binding: records each call to a room and
// answers 204, or what `answer` returns for that call, so tests can check
// what the site asked of which room.
export function fakeRoomBinding({ answer = () => new Response(null, { status: 204 }) } = {}) {
  const calls = [];
  return {
    calls,
    idFromName: name => ({ name }),
    get: id => ({
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const call = {
          page: id.name, url: request.url, method: request.method,
          headers: Object.fromEntries(request.headers),
          body: await request.text(),
        };
        calls.push(call);
        return answer(call);
      },
    }),
  };
}
