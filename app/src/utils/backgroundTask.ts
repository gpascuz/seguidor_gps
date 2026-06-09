import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_TASK_NAME = 'BACKGROUND_LOCATION_TRACKING';

// Definición de la tarea en segundo plano
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Error en la tarea de localización en segundo plano:', error.message);
    return;
  }

  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (!locations || locations.length === 0) return;

    const location = locations[0];
    const { latitude, longitude, speed, accuracy } = location.coords;
    const timestamp = location.timestamp;

    try {
      // Obtener la configuración guardada
      const deviceId = await AsyncStorage.getItem('tracker_device_id');
      const firebaseDbUrl = await AsyncStorage.getItem('tracker_firebase_url');

      if (!deviceId || !firebaseDbUrl) {
        console.log('Falta configuración en segundo plano:', { deviceId, firebaseDbUrl });
        return;
      }

      // Limpiar la URL de Firebase si termina en "/"
      let cleanUrl = firebaseDbUrl.trim();
      if (cleanUrl.endsWith('/')) {
        cleanUrl = cleanUrl.slice(0, -1);
      }

      // Obtener nivel de batería
      let batteryLevel = 1.0;
      try {
        batteryLevel = await Battery.getBatteryLevelAsync();
        // Si retorna -1, significa que no se puede leer en este dispositivo
        if (batteryLevel === -1) batteryLevel = 1.0;
      } catch (batErr) {
        console.log('No se pudo leer la batería:', batErr);
      }

      // Formatear fecha para el historial (YYYY-MM-DD)
      const dateStr = new Date(timestamp).toISOString().split('T')[0];

      // Datos a enviar
      const payload = {
        latitude,
        longitude,
        speed: speed ?? 0,
        accuracy: accuracy ?? 0,
        battery: batteryLevel,
        timestamp,
      };

      // 1. Actualizar última ubicación en tiempo real
      const latestUrl = `${cleanUrl}/devices/${deviceId}.json`;
      const latestResponse = await fetch(latestUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!latestResponse.ok) {
        throw new Error(`Error actualizando ubicación en tiempo real: ${latestResponse.status}`);
      }

      // 2. Guardar en el historial
      const historyPayload = {
        ...payload,
        date: dateStr,
      };
      const historyUrl = `${cleanUrl}/history/${deviceId}/${timestamp}.json`;
      const historyResponse = await fetch(historyUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(historyPayload),
      });

      if (!historyResponse.ok) {
        throw new Error(`Error guardando en historial: ${historyResponse.status}`);
      }

      console.log(`[Segundo Plano] Ubicación enviada con éxito para ${deviceId}:`, { latitude, longitude });
    } catch (err) {
      console.error('Error enviando ubicación en segundo plano:', err);
    }
  }
});
