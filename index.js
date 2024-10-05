const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory storage for anchors
let anchors = [];
let connectionStatus = "Not Connected";
let connectionColor = "lightcoral";
let clientCount = 0;
let nextClientId = 0; // Counter for assigning unique client IDs

// Middleware to parse JSON requests
app.use(express.json());

// Serve a simple HTML page to show the server status
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <meta http-equiv="refresh" content="5"> <!-- Refresh every 5 seconds -->
            </head>
            <body style="background-color: #0c0c0e; font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
                <h2 style="color: #f2f2f2;">The Grid WebSocket server is running</h2>
                <p style="font-size: 20px; color: ${connectionColor}; font-weight: bold;">
                    Connection Status: ${connectionStatus}
                </p>
                <p style="font-size: 20px; color: #f2f2f2; font-weight: bold;">
                    Connected Clients: ${clientCount}
                </p>
            </body>
        </html>
    `);
});

// Endpoint to fetch all anchor data
app.get('/getAllAnchors', (req, res) => {
    res.json(anchors);
});

// New endpoint to clear all anchors
app.get('/clearAllAnchors', (req, res) => {
    anchors = []; // Clear the anchors array
    console.log('All anchors cleared.');
    res.json({ message: 'All anchors have been cleared.' });
});

// New POST endpoint to add or update an anchor
// New POST endpoint to add or update an anchor
app.post('/setAnchor', (req, res) => {
    const { id, latitude, longitude, altitude } = req.body;

    if (!id || latitude === undefined || longitude === undefined || altitude === undefined) {
        return res.status(400).json({ message: 'Invalid input, please provide id, latitude, longitude, and altitude.' });
    }

    // Find if anchor already exists
    const existingAnchorIndex = anchors.findIndex(anchor => anchor.id === id);

    if (existingAnchorIndex > -1) {
        // Update existing anchor
        anchors[existingAnchorIndex] = {
            id,
            latitude,
            longitude,
            altitude,
            lastUpdated: Date.now() // Add timestamp
        };
        console.log(`Updated anchor with ID: ${id}`);
        res.json({ message: `Anchor with ID: ${id} updated successfully.` });
    } else {
        // Create new anchor
        anchors.push({
            id,
            latitude,
            longitude,
            altitude,
            lastUpdated: Date.now() // Add timestamp
        });
        console.log(`Added new anchor with ID: ${id}`);
        res.json({ message: `Anchor with ID: ${id} added successfully.` });
    }
});


// WebSocket connection handling
wss.on('connection', (ws) => {
    const clientId = nextClientId++; // Assign a unique ID to this client
    console.log(`New client connected, ID: ${clientId}`);
    clientCount++; // Increment client count on connection
    connectionStatus = "Connected";
    connectionColor = "darkgreen";

    // Notify all clients of the updated connection status and client count
    broadcastStatus();

    // Listen for incoming messages from the client
    ws.on('message', (message) => {
        console.log(`Client ${clientId} sent message:`, message);

        try {
            const data = JSON.parse(message);

            if (data.type === 'fetchUpdates') {
                console.log(`Client ${clientId} is fetching updates...`);
                const clientAnchors = data.anchorData || [];
                let updates = [];

                if (clientAnchors.length === 0) {
                    // If the client has no anchors, send all server anchors
                    if (anchors.length > 0) {
                        updates = anchors;
                    }
                } else {
                    // Compare timestamps and only send newer anchors
                    clientAnchors.forEach(clientAnchor => {
                        const serverAnchor = anchors.find(anchor => anchor.id === clientAnchor.id);
                        if (serverAnchor && serverAnchor.lastUpdated > clientAnchor.lastUpdated) {
                            updates.push(serverAnchor);
                        }
                    });
                }

                // Send the response
                if (updates.length === 0 && anchors.length > 0) {
                    ws.send(JSON.stringify({ type: 'updateAnchor', anchorData: anchors }));
                } else if (updates.length > 0) {
                    ws.send(JSON.stringify({ type: 'updateAnchor', anchorData: updates }));
                } else {
                    ws.send(JSON.stringify({ type: 'noUpdates', message: 'No updates available from server.' }));
                }
            } else if (data.type === 'fetchFirstUpdate') {
                console.log(`Client ${clientId} requested the first update...`);
                const clientAnchors = data.anchorData || [];
                let responseAnchors = [];

                if (clientAnchors.length === 0) {
                    // If no anchors are sent, return all server anchors
                    responseAnchors = anchors;
                    ws.send(JSON.stringify({ type: 'updateAnchor', anchorData: responseAnchors }));
                } else {
                    // Check if any of the anchors exist
                    let newAnchorsAdded = false;
                    clientAnchors.forEach(clientAnchor => {
                        const existingAnchorIndex = anchors.findIndex(anchor => anchor.id === clientAnchor.id);
                        if (existingAnchorIndex === -1) {
                            // Add new anchor since it doesn't exist
                            anchors.push(clientAnchor);
                            newAnchorsAdded = true;
                            console.log(`Added new anchor with ID: ${clientAnchor.id}`);
                        }
                    });
                    
                    // Return existing anchors list
                    responseAnchors = anchors;
                    ws.send(JSON.stringify({ type: 'updateAnchor', anchorData: responseAnchors }));
                    
                    if (newAnchorsAdded) {
                        console.log(`New anchors added based on client request.`);
                    }
                }
            } else if (data.type === 'updateAnchor') {
                console.log(`Client ${clientId} is updating anchors...`);
                handleUpdateAnchors(data.anchorData);
            } else {
                console.error(`Unknown message type from client ${clientId}:`, data.type);
            }

            console.log(`Current anchors (updated by client ${clientId}):`, anchors);
        } catch (error) {
            console.error(`Error parsing message from client ${clientId}:`, error);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client ${clientId} disconnected`);
        clientCount--; // Decrement client count on disconnection
        connectionStatus = clientCount > 0 ? "Connected" : "Not Connected";
        connectionColor = clientCount > 0 ? "darkgreen" : "lightcoral";

        // Notify all clients of the updated connection status and client count
        broadcastStatus();
    });
});

// Function to broadcast connection status and client count to all clients
function broadcastStatus() {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'statusUpdated',
                status: connectionStatus,
                clientCount: clientCount
            }));
        }
    });
}

// Functions to handle adding, updating, and deleting anchors
function handleUpdateAnchors(anchorDataList) {
    if (Array.isArray(anchorDataList)) {
        anchorDataList.forEach(anchorData => {
            const id = anchorData.id;

            if (id) {
                const existingAnchorIndex = anchors.findIndex(anchor => anchor.id === id);

                if (existingAnchorIndex > -1) {
                    // Compare the new data with the existing one
                    const existingAnchor = anchors[existingAnchorIndex];
                    if (!isAnchorDataEqual(existingAnchor, anchorData)) {
                        // Update the existing anchor if data differs
                        anchors[existingAnchorIndex] = anchorData;
                        console.log(`Updated anchor with ID: ${id}`);
                    } else {
                        console.log(`No update needed for anchor with ID: ${id}`);
                    }
                } else {
                    // Add new anchor if it doesn't exist
                    anchors.push(anchorData);
                    console.log(`Added new anchor with ID: ${id}`);
                }
            } else {
                console.error("Anchor ID is undefined or missing");
            }
        });

        // Broadcast the updated anchors to all connected clients
        broadcastAnchorsToAllClients();
    } else {
        console.error("anchorData is not an array:", anchorDataList);
    }
}

function broadcastAnchorsToAllClients() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'updateAnchor',
                anchorData: anchors
            }));
        }
    });
}


// Utility function to compare anchor data
function isAnchorDataEqual(anchor1, anchor2) {
    return anchor1.latitude === anchor2.latitude &&
           anchor1.longitude === anchor2.longitude &&
           anchor1.altitude === anchor2.altitude;
}

// Start the server
const PORT = 8080;
server.listen(PORT, '::', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
