export const onRequest = async (context) => {
  const user = context.env.TRIP_USERNAME || "PINOS_MADRID_2026";
  const pass = context.env.TRIP_PASSWORD || "2026PINOS!";

  const auth = context.request.headers.get("Authorization") || "";
  const expected = "Basic " + btoa(`${user}:${pass}`);

  if (auth !== expected) {
    return new Response("Accesso negato", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="LOS PINOS Madrid 2026"'
      }
    });
  }

  return context.next();
};
