import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

export default function SignInScreen() {
  const supabase = useMemo<SupabaseClient>(() => {
    // On web, let Supabase use localStorage; on native, use AsyncStorage
    const authOptions = Platform.OS === 'web'
      ? { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
      : { storage: AsyncStorage as any, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false };
    return createClient(supabaseUrl, supabaseAnon, { auth: authOptions as any });
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
  }, []);

  const signUp = useCallback(async () => {
    if (!email || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return Alert.alert('Sign up failed', error.message);
    Alert.alert('Check your email', 'Confirm your email and then sign in.');
  }, [email, password]);

  const signIn = useCallback(async () => {
    if (!email || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return Alert.alert('Sign in failed', error.message);
    const { data } = await supabase.auth.getUser();
    setSessionEmail(data.user?.email ?? null);
  }, [email, password]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSessionEmail(null);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ThemedView style={{ flex: 1, padding: 16 }}>
        <ThemedText style={{ fontSize: 22, fontWeight: '700', marginBottom: 16 }}>Email Auth</ThemedText>
        {sessionEmail ? (
          <View>
            <ThemedText>Signed in as {sessionEmail}</ThemedText>
            <TouchableOpacity onPress={signOut} style={styles.button}><Text style={styles.buttonText}>Sign Out</Text></TouchableOpacity>
          </View>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ gap: 14 }}>
              <View style={{ gap: 6 }}>
                <ThemedText style={styles.label}>Email</ThemedText>
                <TextInput
                  style={[styles.input, { color: '#000', backgroundColor: '#fff', borderColor: '#ccc' }]}
                  placeholder="you@example.com"
                  placeholderTextColor="#666"
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  textContentType={Platform.OS === 'ios' ? 'emailAddress' : 'emailAddress'}
                  autoComplete={Platform.OS === 'web' ? 'email' : 'email'}
                />
              </View>
              <View style={{ gap: 6 }}>
                <ThemedText style={styles.label}>Password</ThemedText>
                <TextInput
                  style={[styles.input, { color: '#000', backgroundColor: '#fff', borderColor: '#ccc' }]}
                  placeholder="Enter your password"
                  placeholderTextColor="#666"
                  accessibilityLabel="Password"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  textContentType={Platform.OS === 'ios' ? 'password' : 'password'}
                  autoComplete={Platform.OS === 'web' ? 'current-password' : 'password'}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity onPress={signIn} disabled={loading} style={styles.button}>
                  <Text style={styles.buttonText}>{loading ? '...' : 'Sign In'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={signUp} disabled={loading} style={[styles.button, styles.secondary]}>
                  <Text style={styles.buttonText}>Sign Up</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: {
    fontWeight: '600',
    color: '#ccc',
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#444',
    color: '#fff',
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#4c8bf5',
  },
  secondary: {
    backgroundColor: '#2a2a2a',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});


