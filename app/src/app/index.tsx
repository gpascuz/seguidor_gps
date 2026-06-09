import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';

import { LOCATION_TASK_NAME } from '../utils/backgroundTask';
import { getMapHtml } from '../utils/mapHtml';

// Temas y Colores Premium
const THEME = {
  bg: '#0b0f19',
  cardBg: 'rgba(17, 24, 39, 0.8)',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#f3f4f6',
  textMuted: '#9ca3af',
  blue: '#3b82f6',
  green: '#10b981',
  red: '#ef4444',
  yellow: '#f59e0b',
  glass: 'rgba(255, 255, 255, 0.03)',
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [appMode, setAppMode] = useState<'setup' | 'emitter' | 'receiver'>('setup');
  
  // Configuración de Firebase
  const [firebaseUrl, setFirebaseUrl] = useState('');
  
  // Modo Emisor (Hija)
  const [deviceId, setDeviceId] = useState('');
  const [pin, setPin] = useState('');
  const [isLocked, setIsLocked] = useState(true);
  const [inputPin, setInputPin] = useState('');
  const [trackingActive, setTrackingActive] = useState(false);
  const [currentBattery, setCurrentBattery] = useState('--%');
  
  // Modo Receptor (Padre)
  const [targetDeviceId, setTargetDeviceId] = useState('');
  
  // Estado de Setup
  const [selectedRole, setSelectedRole] = useState<'emitter' | 'receiver'>('emitter');
  const [step, setStep] = useState<'role' | 'details'>('role');

  // Inicializar y cargar estados guardados
  useEffect(() => {
    loadAppConfig();
    
    // Obtener nivel de batería inicial y escuchar cambios en modo Emisor
    const initBattery = async () => {
      try {
        const power = await Battery.getBatteryLevelAsync();
        if (power !== -1) {
          setCurrentBattery(`${Math.round(power * 100)}%`);
        }
      } catch (err) {
        console.log('Error de batería:', err);
      }
    };
    initBattery();
    
    const batterySubscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      setCurrentBattery(`${Math.round(batteryLevel * 100)}%`);
    });

    return () => {
      batterySubscription.remove();
    };
  }, []);

  const sendForegroundLocation = async (id: string, url: string) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude, speed, accuracy } = loc.coords;
      const timestamp = loc.timestamp;

      let batteryLevel = 1.0;
      try {
        batteryLevel = await Battery.getBatteryLevelAsync();
        if (batteryLevel === -1) batteryLevel = 1.0;
      } catch (batErr) {
        console.log('No se pudo leer la batería en primer plano:', batErr);
      }

      const payload = {
        latitude,
        longitude,
        speed: speed ?? 0,
        accuracy: accuracy ?? 0,
        battery: batteryLevel,
        timestamp,
      };

      let cleanUrl = url.trim();
      if (cleanUrl.endsWith('/')) {
        cleanUrl = cleanUrl.slice(0, -1);
      }

      console.log('[Primer Plano] Enviando ubicación inmediata a Firebase:', cleanUrl);

      // 1. Actualizar última ubicación en tiempo real
      const latestUrl = `${cleanUrl}/devices/${id}.json`;
      const latestResponse = await fetch(latestUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!latestResponse.ok) {
        throw new Error(`HTTP Error ${latestResponse.status}`);
      }

      // 2. Guardar en el historial
      const dateStr = new Date(timestamp).toISOString().split('T')[0];
      const historyUrl = `${cleanUrl}/history/${id}/${timestamp}.json`;
      await fetch(historyUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, date: dateStr }),
      });

      console.log('[Primer Plano] ¡Ubicación de prueba enviada con éxito!');
    } catch (err) {
      console.error('[Primer Plano] Error al enviar ubicación inmediata:', err);
    }
  };

  const loadAppConfig = async () => {
    try {
      const mode = await AsyncStorage.getItem('tracker_mode') as 'emitter' | 'receiver' | null;
      const url = await AsyncStorage.getItem('tracker_firebase_url') || '';
      setFirebaseUrl(url);

      if (mode === 'emitter') {
        const id = await AsyncStorage.getItem('tracker_device_id') || '';
        const savedPin = await AsyncStorage.getItem('tracker_pin') || '';
        setDeviceId(id);
        setPin(savedPin);
        setAppMode('emitter');
        setIsLocked(true);
        
        // Enviar actualización inmediata en primer plano al abrir la app
        sendForegroundLocation(id, url);

        // Auto-activar localización al iniciar en modo emisor
        const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (isRunning) {
          setTrackingActive(true);
        } else {
          // Intentar iniciar el rastreo
          const started = await startLocationTracking();
          setTrackingActive(started);
        }
      } else if (mode === 'receiver') {
        const targetId = await AsyncStorage.getItem('tracker_target_id') || '';
        setTargetDeviceId(targetId);
        setAppMode('receiver');
      } else {
        setAppMode('setup');
      }
    } catch (e) {
      console.error('Error cargando configuración:', e);
    } finally {
      setLoading(false);
    }
  };

  // Activar localización en segundo plano
  const startLocationTracking = async () => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('Error', 'Se requiere permiso de ubicación en primer plano.');
        return false;
      }

      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        Alert.alert(
          'Permiso Requerido',
          'Para el correcto funcionamiento en segundo plano, debes seleccionar "Permitir todo el tiempo" en los ajustes de ubicación.'
        );
        return false;
      }

      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (!isRunning) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 45000, // Cada 45 segundos
          distanceInterval: 0, // Enviar actualizaciones incluso si no hay movimiento significativo
          foregroundService: {
            notificationTitle: 'Seguimiento Activo',
            notificationBody: 'Compartiendo ubicación de forma segura.',
            notificationColor: THEME.blue,
          },
          pausesUpdatesAutomatically: false,
        });
      }
      return true;
    } catch (err) {
      console.error('Error al iniciar rastreo:', err);
      return false;
    }
  };

  // Detener localización
  const stopLocationTracking = async () => {
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
      return true;
    } catch (err) {
      console.error('Error al detener rastreo:', err);
      return false;
    }
  };

  // Guardar configuración inicial
  const handleSaveSetup = async () => {
    if (!firebaseUrl.trim()) {
      Alert.alert('Error', 'Por favor ingresa la URL de Firebase Database.');
      return;
    }

    if (selectedRole === 'emitter') {
      if (!deviceId.trim()) {
        Alert.alert('Error', 'Ingresa el ID del dispositivo (ej. Hija).');
        return;
      }
      if (!pin.trim() || pin.length < 4) {
        Alert.alert('Error', 'El PIN de seguridad debe tener al menos 4 dígitos.');
        return;
      }

      try {
        setLoading(true);
        await AsyncStorage.setItem('tracker_mode', 'emitter');
        await AsyncStorage.setItem('tracker_firebase_url', firebaseUrl.trim());
        await AsyncStorage.setItem('tracker_device_id', deviceId.trim());
        await AsyncStorage.setItem('tracker_pin', pin.trim());

        // Iniciar rastreo
        const started = await startLocationTracking();
        setTrackingActive(started);
        
        if (started) {
          sendForegroundLocation(deviceId.trim(), firebaseUrl.trim());
        }
        
        setAppMode('emitter');
        setIsLocked(true);
      } catch (err) {
        Alert.alert('Error', 'No se pudo guardar la configuración.');
      } finally {
        setLoading(false);
      }
    } else {
      // Modo Receptor
      if (!targetDeviceId.trim()) {
        Alert.alert('Error', 'Ingresa el ID del dispositivo que deseas seguir.');
        return;
      }

      try {
        setLoading(true);
        await AsyncStorage.setItem('tracker_mode', 'receiver');
        await AsyncStorage.setItem('tracker_firebase_url', firebaseUrl.trim());
        await AsyncStorage.setItem('tracker_target_id', targetDeviceId.trim());

        setAppMode('receiver');
      } catch (err) {
        Alert.alert('Error', 'No se pudo guardar la configuración.');
      } finally {
        setLoading(false);
      }
    }
  };

  // Desbloquear Modo Emisor
  const handleUnlock = () => {
    if (inputPin === pin) {
      setIsLocked(false);
      setInputPin('');
    } else {
      Alert.alert('Error', 'PIN incorrecto. Intenta de nuevo.');
      setInputPin('');
    }
  };

  // Cerrar sesión / Reiniciar app
  const handleResetApp = () => {
    Alert.alert(
      'Restaurar Aplicación',
      '¿Estás seguro de que deseas borrar la configuración actual y resetear la aplicación? Se detendrá el rastreo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, Borrar todo',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            await stopLocationTracking();
            await AsyncStorage.clear();
            setFirebaseUrl('');
            setDeviceId('');
            setPin('');
            setInputPin('');
            setTargetDeviceId('');
            setAppMode('setup');
            setStep('role');
            setTrackingActive(false);
            setLoading(false);
          },
        },
      ]
    );
  };

  // Alternar rastreo desde panel desbloqueado
  const handleToggleTracking = async (value: boolean) => {
    setLoading(true);
    if (value) {
      const started = await startLocationTracking();
      setTrackingActive(started);
    } else {
      const stopped = await stopLocationTracking();
      if (stopped) setTrackingActive(false);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={THEME.blue} />
        <Text style={styles.loadingText}>Cargando configuración...</Text>
      </View>
    );
  }

  // PANTALLA 1: CONFIGURACIÓN INICIAL (SETUP)
  if (appMode === 'setup') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scrollContainer}>
            <View style={styles.header}>
              <Text style={styles.title}>Seguidor GPS</Text>
              <Text style={styles.subtitle}>Configuración inicial del sistema</Text>
            </View>

            {step === 'role' ? (
              // Paso 1: Elegir Rol
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Paso 1: Selecciona la función de este dispositivo</Text>
                
                <TouchableOpacity
                  style={[styles.roleButton, selectedRole === 'emitter' && styles.roleButtonActive]}
                  onPress={() => setSelectedRole('emitter')}
                >
                  <View style={[styles.roleRadio, selectedRole === 'emitter' && styles.roleRadioActive]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleTitle}>Dispositivo Emisor (Hija)</Text>
                    <Text style={styles.roleDesc}>Este teléfono enviará las coordenadas en segundo plano. Requiere PIN de seguridad.</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.roleButton, selectedRole === 'receiver' && styles.roleButtonActive]}
                  onPress={() => setSelectedRole('receiver')}
                >
                  <View style={[styles.roleRadio, selectedRole === 'receiver' && styles.roleRadioActive]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleTitle}>Dispositivo Receptor (Padre)</Text>
                    <Text style={styles.roleDesc}>Este teléfono mostrará en un mapa interactivo la ubicación actual del emisor.</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.primaryButton} onPress={() => setStep('details')}>
                  <Text style={styles.buttonText}>Siguiente</Text>
                </TouchableOpacity>
              </View>
            ) : (
              // Paso 2: Detalles de Configuración
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Paso 2: Detalles de Conexión y Seguridad</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>URL de Firebase Realtime Database</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="https://tu-proyecto-rtdb.firebaseio.com"
                    placeholderTextColor={THEME.textMuted}
                    value={firebaseUrl}
                    onChangeText={setFirebaseUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.infoText}>Base de datos para almacenar y leer ubicaciones.</Text>
                </View>

                {selectedRole === 'emitter' ? (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>ID del Dispositivo Emisor</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="maria_gps"
                        placeholderTextColor={THEME.textMuted}
                        value={deviceId}
                        onChangeText={setDeviceId}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Text style={styles.infoText}>Nombre identificador único para este teléfono.</Text>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>PIN de Seguridad (4 dígitos)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="1234"
                        placeholderTextColor={THEME.textMuted}
                        value={pin}
                        onChangeText={val => setPin(val.replace(/[^0-9]/g, ''))}
                        keyboardType="numeric"
                        maxLength={6}
                        secureTextEntry={true}
                      />
                      <Text style={styles.infoText}>Se usará para apagar el rastreo o cambiar configuraciones.</Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>ID del Dispositivo a Seguir</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="maria_gps"
                      placeholderTextColor={THEME.textMuted}
                      value={targetDeviceId}
                      onChangeText={setTargetDeviceId}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Text style={styles.infoText}>Debe coincidir exactamente con el ID puesto en el emisor.</Text>
                  </View>
                )}

                <View style={styles.buttonRow}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep('role')}>
                    <Text style={styles.buttonTextSecondary}>Atrás</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.primaryButton} onPress={handleSaveSetup}>
                    <Text style={styles.buttonText}>Completar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // PANTALLA 2: MODO EMISOR (HIJA) - BLOQUEADO Y DESBLOQUEADO
  if (appMode === 'emitter') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {isLocked ? (
            // SUB-PANTALLA: BLOQUEADA (DURANTE EL SEGUIMIENTO)
            <View style={styles.lockContainer}>
              <View style={styles.pulseContainer}>
                {/* Indicador de Transmisión */}
                <View style={[styles.pulseCircle, trackingActive ? styles.pulseCircleActive : styles.pulseCircleInactive]} />
                <View style={styles.centerIconContainer}>
                  <Text style={styles.centerIconText}>📍</Text>
                </View>
              </View>

              <Text style={styles.lockTitle}>Rastreo de Ubicación</Text>
              <Text style={[styles.lockStatus, trackingActive ? styles.statusTextActive : styles.statusTextInactive]}>
                {trackingActive ? 'SISTEMA ACTIVO' : 'PAUSADO'}
              </Text>
              
              <Text style={styles.lockSubtitle}>ID: {deviceId} | Batería: {currentBattery}</Text>

              {/* Teclado/Input de PIN de seguridad */}
              <View style={styles.lockCard}>
                <Text style={styles.pinLabel}>Ingrese PIN para modificar o desactivar:</Text>
                <TextInput
                  style={styles.pinInput}
                  placeholder="PIN de Seguridad"
                  placeholderTextColor={THEME.textMuted}
                  value={inputPin}
                  onChangeText={val => setInputPin(val.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  maxLength={6}
                  secureTextEntry={true}
                  onSubmitEditing={handleUnlock}
                />
                
                <TouchableOpacity style={styles.primaryButton} onPress={handleUnlock}>
                  <Text style={styles.buttonText}>Desbloquear Configuración</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.disclaimer}>
                Esta pantalla está protegida por motivos de seguridad. Para desactivar, consulta con el administrador.
              </Text>
            </View>
          ) : (
            // SUB-PANTALLA: DESBLOQUEADA (OPCIONES DE ADMINISTRACIÓN)
            <ScrollView contentContainerStyle={styles.scrollContainer}>
              <View style={styles.header}>
                <Text style={styles.title}>Panel Administrativo</Text>
                <Text style={styles.subtitle}>Dispositivo Emisor: {deviceId}</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Control del Rastreo</Text>

                <View style={styles.settingsRow}>
                  <View>
                    <Text style={styles.settingsLabel}>Servicio de Ubicación</Text>
                    <Text style={styles.settingsDesc}>Rastreo en segundo plano activo</Text>
                  </View>
                  <Switch
                    value={trackingActive}
                    onValueChange={handleToggleTracking}
                    trackColor={{ false: '#767577', true: '#3b82f6' }}
                    thumbColor={trackingActive ? '#fff' : '#f4f3f4'}
                  />
                </View>

                <View style={styles.statsCardContainer}>
                  <View style={styles.statMiniCard}>
                    <Text style={styles.statMiniLabel}>Batería</Text>
                    <Text style={styles.statMiniValue}>{currentBattery}</Text>
                  </View>
                  <View style={styles.statMiniCard}>
                    <Text style={styles.statMiniLabel}>Base de Datos</Text>
                    <Text style={styles.statMiniValue} numberOfLines={1}>Firebase OK</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, { marginTop: 15 }]}
                  onPress={() => setIsLocked(true)}
                >
                  <Text style={styles.buttonText}>Bloquear y Reanudar</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Peligro / Configuración Avanzada</Text>
                <Text style={styles.infoText}>
                  Si deseas cambiar el modo de la app, configurar otra base de datos Firebase o desvincular el ID, utiliza la siguiente opción.
                </Text>
                
                <TouchableOpacity style={styles.dangerButton} onPress={handleResetApp}>
                  <Text style={styles.buttonText}>Desvincular y Resetear App</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // PANTALLA 3: MODO RECEPTOR (PADRE) - MAPA EN TIEMPO REAL
  if (appMode === 'receiver') {
    return (
      <SafeAreaView style={styles.mapContainer}>
        <StatusBar style="light" />
        
        {/* Encabezado del Mapa */}
        <View style={styles.mapHeader}>
          <View>
            <Text style={styles.mapTitle}>Seguimiento: {targetDeviceId}</Text>
            <Text style={styles.mapSubtitle}>Actualización en tiempo real (OSM)</Text>
          </View>
          <TouchableOpacity style={styles.mapBackBtn} onPress={handleResetApp}>
            <Text style={{ color: THEME.text, fontWeight: '600', fontSize: 13 }}>Salir</Text>
          </TouchableOpacity>
        </View>

        {/* Mapa Leaflet cargado en un WebView */}
        <WebView
          originWhitelist={['*']}
          source={{ html: getMapHtml(firebaseUrl, targetDeviceId) }}
          style={{ flex: 1 }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data && data.type) {
                console.log(`[WebView ${data.type.toUpperCase()}]`, data.message);
              }
            } catch (err) {
              console.log('[WebView Msg]', event.nativeEvent.data);
            }
          }}
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.absoluteLoading]}>
              <ActivityIndicator size="large" color={THEME.blue} />
              <Text style={[styles.loadingText, { marginTop: 10 }]}>Cargando mapa interactivo...</Text>
            </View>
          )}
        />
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  scrollContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: THEME.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: THEME.textMuted,
    fontSize: 14,
    marginTop: 15,
  },
  header: {
    marginVertical: 25,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: THEME.textMuted,
    marginTop: 5,
  },
  card: {
    backgroundColor: THEME.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 15,
  },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.glass,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  roleButtonActive: {
    borderColor: THEME.blue,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  roleRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: THEME.textMuted,
    marginRight: 15,
  },
  roleRadioActive: {
    borderColor: THEME.blue,
    backgroundColor: THEME.blue,
  },
  roleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  roleDesc: {
    fontSize: 12,
    color: THEME.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 13,
    color: THEME.text,
    marginBottom: 6,
    fontWeight: '500',
  },
  input: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  infoText: {
    fontSize: 11,
    color: THEME.textMuted,
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 15,
  },
  primaryButton: {
    backgroundColor: THEME.blue,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: THEME.glass,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  dangerButton: {
    backgroundColor: THEME.red,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  buttonTextSecondary: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  
  // LOCKSCREEN STYLE
  lockContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pulseContainer: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  pulseCircle: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.15,
  },
  pulseCircleActive: {
    backgroundColor: THEME.green,
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: THEME.green,
    // Nota: El pulso real se hace por animación, pero la estética simple ya es premium.
  },
  pulseCircleInactive: {
    backgroundColor: THEME.red,
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: THEME.red,
  },
  centerIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  centerIconText: {
    fontSize: 28,
  },
  lockTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  lockSubtitle: {
    fontSize: 14,
    color: THEME.textMuted,
    marginTop: 4,
  },
  lockStatus: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },
  statusTextActive: {
    color: THEME.green,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  statusTextInactive: {
    color: THEME.red,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  lockCard: {
    width: '100%',
    backgroundColor: THEME.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 20,
    marginVertical: 25,
  },
  pinLabel: {
    color: THEME.text,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  pinInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    color: '#fff',
    paddingVertical: 12,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 15,
    letterSpacing: 5,
  },
  disclaimer: {
    fontSize: 11,
    color: THEME.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 16,
  },

  // PANEL DESBLOQUEADO EMISOR
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    paddingBottom: 15,
    marginBottom: 15,
  },
  settingsLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  settingsDesc: {
    color: THEME.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  statsCardContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  statMiniCard: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    padding: 12,
  },
  statMiniLabel: {
    fontSize: 11,
    color: THEME.textMuted,
    textTransform: 'uppercase',
  },
  statMiniValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },

  // MAP STYLE (RECEIVER)
  mapContainer: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.bg,
  },
  mapTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  mapSubtitle: {
    fontSize: 11,
    color: THEME.textMuted,
    marginTop: 2,
  },
  mapBackBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: THEME.glass,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  absoluteLoading: {
    backgroundColor: THEME.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
