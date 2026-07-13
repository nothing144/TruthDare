// Netlify serverless function to fetch TURN credentials from Metered.ca
// This keeps the API key secure on the server side
export default async () => {
  const apiKey = process.env.METERED_API_KEY;
  
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'METERED_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const response = await fetch(
      `https://truthdare.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );
    
    if (!response.ok) {
      throw new Error(`Metered API error: ${response.status}`);
    }

    const iceServers = await response.json();

    return new Response(JSON.stringify(iceServers), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300' // Cache for 5 minutes
      }
    });
  } catch (err) {
    console.error('Error fetching TURN credentials:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch TURN credentials' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
