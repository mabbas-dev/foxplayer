import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import Colors from '../constants/colors';
import { SearchIcon, CloseIcon } from './Icons';

export default function AnimatedSearchBar({
  value = '',
  onChangeText,
  onClear,
  placeholders = ['Search channels...', 'Search movies...', 'Search series...', 'Type to find content...'],
  style,
  autoFocus = false,
}) {
  const [isFocused, setIsFocused]           = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  // Keep in refs — only mutated in effects / callbacks, never read during render
  const fadeAnimRef   = useRef(new Animated.Value(1));
  const borderAnimRef = useRef(new Animated.Value(0));

  // Cycle animated placeholder smoothly every 3.2 s if not typing
  useEffect(() => {
    if (value || isFocused) return;

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnimRef.current, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(fadeAnimRef.current, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();

      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3200);

    return () => clearInterval(interval);
  }, [value, isFocused, placeholders.length]);

  const handleFocus = () => {
    setIsFocused(true);
    Animated.timing(borderAnimRef.current, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.timing(borderAnimRef.current, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const handleClear = () => {
    if (onChangeText) onChangeText('');
    if (onClear) onClear();
  };

  const borderColorInterpolated = borderAnimRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.border.default, Colors.brand.primary],
  });

  const backgroundColorInterpolated = borderAnimRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.background.card, Colors.background.cardActive],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          borderColor: borderColorInterpolated,
          backgroundColor: backgroundColorInterpolated,
        },
        style,
      ]}
    >
      <View style={styles.iconWrapper}>
        <SearchIcon
          size={16}
          color={isFocused || value ? Colors.brand.primary : Colors.text.secondary}
        />
      </View>

      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor="transparent"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          autoFocus={autoFocus}
          accessibilityLabel="Search"
        />

        {!value && (
          <Animated.Text
            pointerEvents="none"
            style={[styles.placeholderText, { opacity: fadeAnimRef.current }]}
            numberOfLines={1}
          >
            {placeholders[placeholderIndex]}
          </Animated.Text>
        )}
      </View>

      {!!value && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClear}
          activeOpacity={0.7}
          accessibilityLabel="Clear search text"
        >
          <CloseIcon size={14} color={Colors.text.secondary} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 36,
    overflow: 'hidden',
  },
  iconWrapper: {
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrapper: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
    height: '100%',
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  placeholderText: {
    position: 'absolute',
    left: 0,
    right: 0,
    color: Colors.text.tertiary,
    fontSize: 13,
    fontWeight: '400',
  },
  clearBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
