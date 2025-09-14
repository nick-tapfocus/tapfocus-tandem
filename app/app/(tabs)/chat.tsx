import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Colors } from '@/constants/theme';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  analysis?: { anger?: number } | null;
};

export default function ChatScreen() {
  const colorScheme = useColorScheme();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'sys', role: 'system', content: 'You are a helpful assistant.' },
  ]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  const supabase = useMemo(() => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
    const authOptions = Platform.OS === 'web'
      ? { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
      : { storage: AsyncStorage as any, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false };
    return createClient(url, key, { auth: authOptions as any });
  }, []);

  // On load: pick most recent chat for this user from DB
  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;
      const { data } = await supabase
        .from('chats')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id) setChatId(data.id);
    })();
  }, [supabase]);

  // Load existing messages for this chat
  useEffect(() => {
    (async () => {
      if (!chatId) return;
      const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, analysis')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      if (error) return;
      const history: ChatMessage[] = (data || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        analysis: m.analysis ?? null,
      }));
      setMessages([{ id: 'sys', role: 'system', content: 'You are a helpful assistant.' }, ...history]);
    })();
  }, [chatId, supabase]);

  // Realtime for this chat: assistant inserts and analysis updates
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`messages_${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const row = payload.new as any;
          if (row.role === 'assistant') {
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              return [...prev, { id: row.id, role: 'assistant', content: row.content } as ChatMessage];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const updated = payload.new as any;
          // Debug log
          console.log('[chat] UPDATE payload', updated);
          const anger = updated?.analysis?.anger as number | undefined;
          const updatedId = updated?.id as string | undefined;
          if (typeof anger === 'number' && updatedId) {
            setMessages((prev) => {
              const next = [...prev];
              let idx = next.findIndex((m) => m.id === updatedId);
              // Fallback: match by content if id not yet swapped in UI
              if (idx < 0 && typeof updated.content === 'string') {
                for (let i = next.length - 1; i >= 0; i--) {
                  const m = next[i];
                  if (m.role === 'user' && m.content === updated.content && !m.analysis) {
                    idx = i;
                    break;
                  }
                }
              }
              if (idx >= 0) next[idx] = { ...next[idx], id: updatedId, analysis: { anger } } as ChatMessage;
              return next;
            });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, chatId]);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;
    const userMsg: ChatMessage = { id: String(Date.now()), role: 'user', content };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const payload = { content, chatId: chatId ?? undefined };
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(getApiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log('[chat] API response', data);
      if (data.userMessageId) {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === userMsg.id);
          if (idx >= 0) next[idx] = { ...next[idx], id: data.userMessageId };
          return next;
        });
      }
      if (data.chatId && !chatId) {
        setChatId(data.chatId);
      }
    } catch (e) {
      const err: ChatMessage = {
        id: 'err-' + String(Date.now()),
        role: 'assistant',
        content: 'Failed to reach chatbot. Please try again.',
      };
      setMessages((prev) => [...prev, err]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, chatId, supabase]);

  const renderItem = ({ item }: { item: ChatMessage }) => {
    if (item.role === 'system') return null;
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.botText]}>{item.content}</Text>
        {isUser && typeof item.analysis?.anger === 'number' && (
          <Text style={[styles.meta, isUser ? styles.userText : styles.botText]}>Anger: {item.analysis?.anger}/5</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ThemedView style={{ flex: 1, paddingHorizontal: 12, paddingTop: 8 }}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      </ThemedView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message"
            placeholderTextColor="#888"
            value={input}
            onChangeText={setInput}
            multiline
          />
          <TouchableOpacity onPress={send} disabled={sending || input.trim().length === 0} style={styles.sendBtn}>
            <ThemedText style={{ fontWeight: '600' }}>{sending ? '...' : 'Send'}</ThemedText>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getApiUrl(path: string) {
  const envBase = process.env.EXPO_PUBLIC_API_BASE?.trim();
  if (envBase) return `${envBase}${path}`;
  // Sensible defaults for local dev
  const base = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
  return `${base}${path}`;
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#1f1f1f33',
    color: '#fff',
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#4c8bf5',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    marginVertical: 6,
    alignSelf: 'flex-start',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4c8bf5',
  },
  botBubble: {
    backgroundColor: '#2a2a2a',
  },
  text: {
    fontSize: 16,
    lineHeight: 20,
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.8,
  },
  userText: {
    color: '#fff',
  },
  botText: {
    color: '#fff',
  },
});


