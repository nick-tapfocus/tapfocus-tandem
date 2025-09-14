import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
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
  const channelReadyRef = useRef(false);
  const pendingAnalysisRef = useRef<Record<string, number>>({});

  // Use singleton supabase client to avoid duplicate auth/storage instances

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

  // Realtime for this chat: assistant inserts and analysis updates (catch-all, local filter)
  useEffect(() => {
    if (!chatId) return;
    channelReadyRef.current = false;
    const channel = supabase
      .channel(`messages_${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as any;
        if (!row || row.chat_id !== chatId) return;
        console.log('[chat] PG change', payload.eventType, row);
        if (payload.eventType === 'INSERT') {
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            const next = [...prev];
            if (row.role === 'user') {
              // Upgrade optimistic user message (temp id) to DB id by content match
              let idx = -1;
              for (let i = next.length - 1; i >= 0; i--) {
                const m = next[i];
                const isTempId = typeof m.id === 'string' && !m.id.includes('-');
                if (m.role === 'user' && isTempId && m.content === row.content) { idx = i; break; }
              }
              if (idx >= 0) {
                next[idx] = { ...next[idx], id: row.id } as ChatMessage;
                // Apply any pending analysis now that we have the real id
                const pendingAnger = pendingAnalysisRef.current[row.id];
                if (typeof pendingAnger === 'number') {
                  next[idx] = { ...next[idx], analysis: { anger: pendingAnger } } as ChatMessage;
                  delete pendingAnalysisRef.current[row.id];
                }
                return next;
              }
            }
            // Append new row (assistant or unmatched user)
            next.push({ id: row.id, role: row.role, content: row.content } as ChatMessage);
            return next;
          });
          return;
        }
        if (payload.eventType === 'UPDATE') {
          const anger = row?.analysis?.anger as number | undefined;
          const updatedId = row?.id as string | undefined;
          if (typeof anger === 'number' && updatedId) {
            setMessages((prev) => {
              const next = [...prev];
              let idx = next.findIndex((m) => m.id === updatedId);
              if (idx < 0 && typeof row.content === 'string') {
                for (let i = next.length - 1; i >= 0; i--) {
                  const m = next[i];
                  if (m.role === 'user' && m.content === row.content && !m.analysis) { idx = i; break; }
                }
              }
              if (idx >= 0) next[idx] = { ...next[idx], id: updatedId, analysis: { anger } } as ChatMessage;
              else pendingAnalysisRef.current[updatedId] = anger;
              return next;
            });
          }
        }
      })
      .subscribe((status: any) => {
        if (status === 'SUBSCRIBED') {
          channelReadyRef.current = true;
          console.log('[chat] Realtime subscribed for chat', chatId);
        }
      });
    return () => {
      supabase.removeChannel(channel);
      channelReadyRef.current = false;
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
        // Apply any pending analysis captured before id swap
        const pendingAnger = pendingAnalysisRef.current[data.userMessageId];
        if (typeof pendingAnger === 'number') {
          setMessages((prev) => {
            const next = [...prev];
            const i = next.findIndex((m) => m.id === data.userMessageId);
            if (i >= 0) next[i] = { ...next[i], analysis: { anger: pendingAnger } } as ChatMessage;
            return next;
          });
          delete pendingAnalysisRef.current[data.userMessageId];
        }
      }
      if (data.chatId && !chatId) {
        setChatId(data.chatId);
      }

      // Immediately append assistant reply once with server-provided id; Realtime will no-op due to dedupe
      if (data.assistantMessageId && typeof data.reply === 'string') {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.assistantMessageId)) return prev;
          return [...prev, { id: data.assistantMessageId, role: 'assistant', content: data.reply } as ChatMessage];
        });
      }

      // Backfill in case INSERT/UPDATE happened before SUBSCRIBED
      const finalChatId: string | null = chatId ?? data.chatId ?? null;
      if (finalChatId) {
        try {
          const { data: recent } = await supabase
            .from('messages')
            .select('id, role, content, analysis')
            .eq('chat_id', finalChatId)
            .order('created_at', { ascending: true })
            .limit(10);
          if (recent && Array.isArray(recent)) {
            setMessages((prev) => {
              const ids = new Set(prev.map((m) => m.id));
              const toAdd = recent
                .filter((m: any) => !ids.has(m.id))
                .map((m: any) => ({ id: m.id, role: m.role, content: m.content, analysis: m.analysis ?? null } as ChatMessage));
              return toAdd.length ? [...prev, ...toAdd] : prev;
            });
          }
        } catch {}
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


