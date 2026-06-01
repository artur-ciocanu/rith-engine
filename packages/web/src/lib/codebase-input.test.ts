import { describe, expect, test } from 'bun:test';
import { getCodebaseInput } from '@/lib/codebase-input';

describe('getCodebaseInput', () => {
  test('treats GitHub repository inputs as urls', () => {
    expect(getCodebaseInput('https://github.com/artur-ciocanu/rith-engine')).toEqual({
      url: 'https://github.com/artur-ciocanu/rith-engine',
    });
  });

  test('treats SSH git@ shorthand as urls', () => {
    expect(getCodebaseInput('git@github.com:artur-ciocanu/rith-engine.git')).toEqual({
      url: 'git@github.com:artur-ciocanu/rith-engine.git',
    });
  });

  test('treats ssh:// URLs as urls', () => {
    expect(getCodebaseInput('ssh://git@github.com/artur-ciocanu/rith-engine.git')).toEqual({
      url: 'ssh://git@github.com/artur-ciocanu/rith-engine.git',
    });
  });

  test('treats git:// URLs as urls', () => {
    expect(getCodebaseInput('git://github.com/artur-ciocanu/rith-engine.git')).toEqual({
      url: 'git://github.com/artur-ciocanu/rith-engine.git',
    });
  });

  test('trims surrounding whitespace before classifying', () => {
    expect(getCodebaseInput('  https://github.com/a/b  ')).toEqual({
      url: 'https://github.com/a/b',
    });
  });

  test('treats relative local paths as paths', () => {
    expect(getCodebaseInput('./repo')).toEqual({ path: './repo' });
    expect(getCodebaseInput('../repo')).toEqual({ path: '../repo' });
    expect(getCodebaseInput('repo')).toEqual({ path: 'repo' });
  });

  test('treats unix local paths as paths', () => {
    expect(getCodebaseInput('/path/to/repository')).toEqual({
      path: '/path/to/repository',
    });
  });

  test('treats home-relative paths as paths', () => {
    expect(getCodebaseInput('~/src/rith')).toEqual({
      path: '~/src/rith',
    });
  });

  test('treats windows local paths as paths', () => {
    expect(getCodebaseInput('C:\\repo\\rith')).toEqual({
      path: 'C:\\repo\\rith',
    });
  });

  test('treats windows UNC paths as paths', () => {
    expect(getCodebaseInput('\\\\server\\share\\rith')).toEqual({
      path: '\\\\server\\share\\rith',
    });
  });
});
