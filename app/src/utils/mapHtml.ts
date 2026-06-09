export function getMapHtml(firebaseDbUrl: string, targetDeviceId: string): string {
  // Limpiar la URL de Firebase si termina en "/"
  let cleanUrl = firebaseDbUrl.trim();
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1);
  }

  const today = new Date().toISOString().split('T')[0];

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <title>Mapa de Seguimiento</title>
      
      <!-- Leaflet CSS -->
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
      
      <!-- FontAwesome Icons -->
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body, html, #map {
          width: 100%;
          height: 100%;
          background: #0b0f19;
        }
        
        /* Contenedor flotante de estado */
        .status-container {
          position: absolute;
          bottom: 24px;
          left: 16px;
          right: 16px;
          background: rgba(17, 24, 39, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 16px;
          z-index: 1000;
          color: #f3f4f6;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .status-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .device-id {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
        }
        
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #9ca3af;
        }
        .dot.online {
          background: #10b981;
          box-shadow: 0 0 8px #10b981;
        }
        .dot.offline {
          background: #ef4444;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        
        .stat-card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .stat-label {
          font-size: 10px;
          color: #9ca3af;
          text-transform: uppercase;
        }
        
        .stat-value {
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .stat-value i {
          color: #3b82f6;
        }
        
        .stat-value.battery-good i { color: #10b981; }
        .stat-value.battery-warn i { color: #f59e0b; }
        .stat-value.battery-low i { color: #ef4444; }
        
        .updated-time {
          font-size: 11px;
          color: #9ca3af;
          text-align: center;
          margin-top: 4px;
        }
        
        /* Personalización de Leaflet para mapa oscuro */
        .leaflet-tile-layer {
          filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
        }
        
        .leaflet-bar {
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          background: rgba(17, 24, 39, 0.85) !important;
          backdrop-filter: blur(10px);
        }
        
        .leaflet-bar a {
          background: transparent !important;
          color: #f3f4f6 !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        
        /* Marcador personalizado */
        .custom-marker {
          background: #3b82f6;
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 15px #3b82f6;
          width: 16px;
          height: 16px;
        }
        
        .custom-marker.pulse::after {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid #3b82f6;
          animation: pulseMarker 1.8s infinite;
          box-sizing: content-box;
        }
        
        @keyframes pulseMarker {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(3.5); opacity: 0; }
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      
      <!-- Panel de Estado -->
      <div class="status-container">
        <div class="status-header">
          <div class="device-id">${targetDeviceId}</div>
          <div class="status-indicator">
            <div class="dot" id="status-dot"></div>
            <span id="status-text">Buscando...</span>
          </div>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-label">Batería</span>
            <span class="stat-value" id="battery-val">
              <i class="fa-solid fa-battery-half"></i> <span>--%</span>
            </span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Velocidad</span>
            <span class="stat-value" id="speed-val">
              <i class="fa-solid fa-gauge-high"></i> <span>0 km/h</span>
            </span>
          </div>
        </div>
        
        <div class="updated-time" id="time-val">
          Esperando datos...
        </div>
      </div>
      
      <!-- Firebase JS SDK v8 -->
      <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
      <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"></script>
      
      <!-- Leaflet JS -->
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      
      <script>
        // Redirigir consola a React Native para depuración
        (function() {
          const sendToApp = (type, message) => {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type, message }));
            }
          };
          
          console.log = (...args) => sendToApp('log', args.join(' '));
          console.error = (...args) => sendToApp('error', args.join(' '));
          console.warn = (...args) => sendToApp('warn', args.join(' '));
          
          window.onerror = (message, source, lineno, colno, error) => {
            sendToApp('error', message + ' (' + source + ':' + lineno + ')');
            return false;
          };
        })();

        console.log("Iniciando carga de scripts en WebView...");

        let map;
        let marker;
        let historyPolyline;

        // Esperar a que las librerías estén cargadas para evitar ReferenceErrors
        function checkLibraries() {
          if (typeof firebase !== 'undefined' && typeof L !== 'undefined') {
            console.log("Librerías listas. Inicializando aplicación...");
            startApp();
          } else {
            console.log("Esperando librerías...");
            setTimeout(checkLibraries, 100);
          }
        }

        function startApp() {
          try {
            // Inicializar mapa
            map = L.map('map', { zoomControl: false }).setView([0, 0], 2);
            
            // Capa oscura de CartoDB (gratuita)
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
              maxZoom: 19,
              attribution: '&copy; OpenStreetMap'
            }).addTo(map);
            
            // Polilínea para el historial
            historyPolyline = L.polyline([], {
              color: '#3b82f6',
              weight: 4,
              opacity: 0.7,
              dashArray: '5, 10'
            }).addTo(map);
            
            console.log("Mapa cargado. Conectando a Firebase Realtime Database...");
            
            // Inicializar Firebase
            const config = { databaseURL: "${cleanUrl}" };
            firebase.initializeApp(config);
            const db = firebase.database();
            
            // Escuchar ubicación en tiempo real
            db.ref('devices/${targetDeviceId}').on('value', (snapshot) => {
              const data = snapshot.val();
              console.log("Datos recibidos en tiempo real para ${targetDeviceId}:", JSON.stringify(data));
              if (data) {
                updateUI(data);
                updateMarker(data);
              } else {
                console.log("No se encontraron registros para ${targetDeviceId}. Esperando...");
                document.getElementById('status-text').innerText = 'Sin registros';
                document.getElementById('status-dot').className = 'dot offline';
              }
            }, (error) => {
              console.error("Error al suscribirse a los datos de Firebase:", error.message);
            });
            
            // Escuchar historial de hoy
            db.ref('history/${targetDeviceId}').orderByChild('date').equalTo('${today}').on('value', (snapshot) => {
              const data = snapshot.val();
              if (data) {
                const historyData = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);
                const points = historyData.map(pt => [pt.latitude, pt.longitude]);
                historyPolyline.setLatLngs(points);
              }
            });
          } catch (e) {
            console.error("Excepción en startApp:", e.message);
          }
        }
        
        function updateUI(data) {
          try {
            const lat = data.latitude;
            const lng = data.longitude;
            const battery = data.battery !== undefined ? Math.round(data.battery * 100) : null;
            const speed = data.speed !== undefined ? Math.round(data.speed * 3.6) : 0;
            const timestamp = data.timestamp;
            
            // Velocidad
            document.getElementById('speed-val').querySelector('span').innerText = speed + ' km/h';
            
            // Batería
            const batterySpan = document.getElementById('battery-val');
            const batteryIcon = batterySpan.querySelector('i');
            const batteryText = batterySpan.querySelector('span');
            
            if (battery !== null) {
              batteryText.innerText = battery + '%';
              batterySpan.className = 'stat-value';
              
              if (battery > 50) {
                batterySpan.classList.add('battery-good');
                batteryIcon.className = 'fa-solid fa-battery-three-quarters';
              } else if (battery > 20) {
                batterySpan.classList.add('battery-warn');
                batteryIcon.className = 'fa-solid fa-battery-quarter';
              } else {
                batterySpan.classList.add('battery-low');
                batteryIcon.className = 'fa-solid fa-battery-empty';
              }
            }
            
            // Estado Online (actualizado en los últimos 5 minutos)
            const diffMs = Date.now() - timestamp;
            const isOnline = diffMs < 300000;
            
            const dot = document.getElementById('status-dot');
            const txt = document.getElementById('status-text');
            
            if (isOnline) {
              dot.className = 'dot online';
              txt.innerText = 'Conectado';
              txt.style.color = '#10b981';
            } else {
              dot.className = 'dot offline';
              txt.innerText = 'Desconectado';
              txt.style.color = '#ef4444';
            }
            
            const time = new Date(timestamp);
            document.getElementById('time-val').innerText = 'Actualizado: ' + time.toLocaleTimeString();
          } catch (err) {
            console.error("Error al actualizar la interfaz UI:", err.message);
          }
        }
        
        function updateMarker(data) {
          try {
            const pos = [data.latitude, data.longitude];
            
            if (!marker) {
              const customIcon = L.divIcon({
                className: 'custom-marker pulse',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
              });
              marker = L.marker(pos, { icon: customIcon }).addTo(map);
              map.setView(pos, 16);
            } else {
              marker.setLatLng(pos);
              map.panTo(pos);
            }
          } catch (err) {
            console.error("Error al actualizar marcador en mapa:", err.message);
          }
        }

        // Arrancar verificación
        window.onload = checkLibraries;
      </script>
    </body>
    </html>
  `;
}
