import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList } from 'react-native';
import { Colors } from '@/constants/theme';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export default function ChatScreen() {
  const colorScheme = useColorScheme();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'sys', role: 'system', content: 'You are a helpful assistant.' },
  ]);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

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
      const payload = {
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content }))
          .concat([{ role: 'user' as const, content }]),
      };
      const res = await fetch(getApiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const reply: ChatMessage = {
        id: 'a-' + String(Date.now()),
        role: 'assistant',
        content: data.reply ?? '...',
      };
      setMessages((prev) => [...prev, reply]);
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
  }, [input, sending, messages]);

  const renderItem = ({ item }: { item: ChatMessage }) => {
    if (item.role === 'system') return null;
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.botText]}>{item.content}</Text>
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
  userText: {
    color: '#fff',
  },
  botText: {
    color: '#fff',
  },
});


